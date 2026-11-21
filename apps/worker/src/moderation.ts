import {
  CaseNotFoundError,
  IllegalTransitionError,
  TransitionConflictError,
  decideVerdict,
  transitionCase,
  type ModerationDb,
  type ModerationJob,
  type ModerationProvider,
  type ModerationThresholds,
  type VerifiedBuyerStore,
  DEFAULT_THRESHOLDS,
} from "@rp/core";

/** What the processor needs beyond the shared transition DB: reading and creating cases/reviews. */
export interface WorkerDb extends ModerationDb {
  moderationCase: ModerationDb["moderationCase"] & {
    upsert(args: unknown): Promise<{ id: string; state: string; version: number; reviewId: string }>;
  };
}

export type ModerationOutcome = "APPROVED" | "REJECTED" | "NEEDS_HUMAN" | "SKIPPED";

/**
 * Handles one moderation job (idempotent; safe under at-least-once delivery).
 * Any provider error throws so BullMQ retries; the dead-letter hook (below) escalates to a human.
 */
export async function processModeration(
  db: WorkerDb,
  provider: ModerationProvider,
  job: ModerationJob,
  opts: { jobId?: string; thresholds?: ModerationThresholds; verifyBuyer?: (reviewId: string) => Promise<boolean> } = {},
): Promise<ModerationOutcome> {
  if (job.subjectType !== "REVIEW") return "SKIPPED"; // other subjects arrive with their features
  const review = await db.review.findUnique({
    where: { id: job.subjectId },
    select: { id: true, status: true, currentVersion: true, rating: true, title: true, body: true },
  });
  if (!review || review.currentVersion !== job.version || review.status !== "PENDING") return "SKIPPED"; // stale/deleted/decided

  const c = await db.moderationCase.upsert({
    where: { reviewId_version: { reviewId: review.id, version: job.version } },
    create: { reviewId: review.id, version: job.version },
    update: {},
  });
  if (c.state === "PENDING") {
    try {
      await transitionCase(db, { caseId: c.id, to: "AI_REVIEW", actor: { type: "SYSTEM" }, meta: { jobId: opts.jobId } });
    } catch (e) {
      if (e instanceof TransitionConflictError || e instanceof IllegalTransitionError) return "SKIPPED"; // another worker won
      throw e;
    }
  } else if (c.state !== "AI_REVIEW") {
    return "SKIPPED"; // already decided or with a human
  }

  // Verified Buyer is independent of the AI verdict and must not block moderation if the order lookup fails.
  await opts.verifyBuyer?.(review.id).catch((e: Error) => console.warn(JSON.stringify({ msg: "verified_buyer.error", err: e.message })));

  const assessment = await provider.assess({ title: review.title, body: review.body, rating: review.rating });
  const verdict = decideVerdict(assessment, opts.thresholds ?? DEFAULT_THRESHOLDS);
  try {
    await transitionCase(db, {
      caseId: c.id,
      to: verdict,
      actor: { type: "AI", provider: provider.name },
      ai: { ...assessment, provider: provider.name },
      reason: verdict === "NEEDS_HUMAN" ? "low_confidence_or_borderline" : undefined,
      meta: { jobId: opts.jobId },
    });
  } catch (e) {
    if (e instanceof TransitionConflictError || e instanceof IllegalTransitionError) return "SKIPPED";
    throw e;
  }
  return verdict;
}

/**
 * Called when a job has exhausted its retries. Fails closed: the review goes to the human queue
 * (never auto-approved). Returns false if there was nothing to escalate.
 */
export async function escalateDeadLetter(db: WorkerDb, job: ModerationJob, error: string, jobId?: string): Promise<boolean> {
  if (job.subjectType !== "REVIEW") return false;
  const review = await db.review.findUnique({
    where: { id: job.subjectId },
    select: { id: true, status: true, currentVersion: true, rating: true, title: true, body: true },
  });
  if (!review || review.currentVersion !== job.version) return false;
  const c = await db.moderationCase.upsert({
    where: { reviewId_version: { reviewId: review.id, version: job.version } },
    create: { reviewId: review.id, version: job.version },
    update: {},
  });
  try {
    await transitionCase(db, {
      caseId: c.id,
      to: "NEEDS_HUMAN",
      actor: { type: "SYSTEM" },
      reason: "ai_failure_dead_letter",
      meta: { jobId, error: error.slice(0, 200) },
    });
    return true;
  } catch (e) {
    if (e instanceof TransitionConflictError || e instanceof IllegalTransitionError || e instanceof CaseNotFoundError) return false;
    throw e;
  }
}

export const MODERATION_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: false,
};

/** True when BullMQ will not retry this failure again. */
export const isFinalFailure = (job: { attemptsMade: number; opts: { attempts?: number } }) =>
  job.attemptsMade >= (job.opts.attempts ?? 1);

/** Prisma-backed Verified Buyer store (structural, so tests can fake it). */
export interface VerifiedBuyerDb {
  review: {
    findUnique(args: unknown): Promise<{ id: string; authorId: string; productId: string; verifiedBuyer: boolean } | null>;
    update(args: unknown): Promise<unknown>;
  };
}
export const verifiedBuyerStore = (db: VerifiedBuyerDb): VerifiedBuyerStore => ({
  findReview: (id) => db.review.findUnique({ where: { id }, select: { id: true, authorId: true, productId: true, verifiedBuyer: true } }),
  setVerified: async (id, orderId, at) => {
    await db.review.update({ where: { id }, data: { verifiedBuyer: true, verifiedAt: at, verifiedOrderId: orderId } });
  },
});
