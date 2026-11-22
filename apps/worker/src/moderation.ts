import {
  CaseNotFoundError,
  IllegalTransitionError,
  TransitionConflictError,
  decideVerdict,
  checkReplyPolicy,
  replyForcesHuman,
  transitionCase,
  type ModerationDb,
  type ModerationJob,
  type ModerationProvider,
  type ModerationThresholds,
  DEFAULT_THRESHOLDS,
} from "@rp/core";

/** What the processor needs beyond the shared transition DB: reading and creating cases/reviews. */
export interface WorkerDb extends ModerationDb {
  moderationCase: ModerationDb["moderationCase"] & {
    upsert(args: unknown): Promise<{ id: string; state: string; version: number; reviewId: string | null }>;
  };
  /** Needed for SELLER_REPLY jobs. */
  sellerReply?: NonNullable<ModerationDb["sellerReply"]> & {
    count(args: unknown): Promise<number>;
  };
}

const REPLY_SELECT = { id: true, sellerId: true, status: true, version: true, body: true } as const;
interface ReplyRow { id: string; sellerId: string; status: string; version: number; body: string }

/**
 * SELLER_REPLY branch (m3b-spec 5.3). Same provider and state machine as reviews. Forced NEEDS_HUMAN: any soft flag
 * (recomputed here from the stored body, the job carries ids only), the seller's first replies, and provider failure
 * (the dead-letter hook). A decision on a stale version is a no-op (the transition guard on reply.version).
 */
async function processReply(db: WorkerDb, provider: ModerationProvider, job: ModerationJob, opts: { jobId?: string; thresholds?: ModerationThresholds }): Promise<ModerationOutcome> {
  if (!db.sellerReply) return "SKIPPED";
  const reply = (await db.sellerReply.findUnique({ where: { id: job.subjectId }, select: REPLY_SELECT })) as ReplyRow | null;
  if (!reply || reply.version !== job.version || reply.status !== "PENDING") return "SKIPPED"; // stale/deleted/decided
  const c = await db.moderationCase.upsert({
    where: { sellerReplyId_version_trigger_seq: { sellerReplyId: reply.id, version: job.version, trigger: "SUBMISSION", seq: 1 } },
    create: { subjectType: "SELLER_REPLY", sellerReplyId: reply.id, version: job.version },
    update: {},
  });
  if (c.state === "PENDING") {
    try {
      await transitionCase(db, { caseId: c.id, to: "AI_REVIEW", actor: { type: "SYSTEM" }, meta: { jobId: opts.jobId } });
    } catch (e) {
      if (e instanceof TransitionConflictError || e instanceof IllegalTransitionError) return "SKIPPED";
      throw e;
    }
  } else if (c.state !== "AI_REVIEW") {
    return "SKIPPED";
  }
  const assessment = await provider.assess({ title: "", body: reply.body, rating: 3 });
  let verdict = decideVerdict(assessment, opts.thresholds ?? DEFAULT_THRESHOLDS);
  let reason: string | undefined = verdict === "NEEDS_HUMAN" ? "low_confidence_or_borderline" : undefined;
  if (verdict === "APPROVED") {
    const prior = await db.sellerReply.count({ where: { sellerId: reply.sellerId, status: "PUBLISHED", id: { not: reply.id } } });
    const { soft } = checkReplyPolicy(reply.body);
    if (replyForcesHuman(soft, prior)) {
      verdict = "NEEDS_HUMAN";
      reason = soft.length > 0 ? "reply_soft_flag" : "reply_new_seller";
    }
  }
  try {
    await transitionCase(db, { caseId: c.id, to: verdict, actor: { type: "AI", provider: provider.name }, ai: { ...assessment, provider: provider.name }, reason, meta: { jobId: opts.jobId } });
  } catch (e) {
    if (e instanceof TransitionConflictError || e instanceof IllegalTransitionError) return "SKIPPED";
    throw e;
  }
  return verdict;
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
  opts: { jobId?: string; thresholds?: ModerationThresholds } = {},
): Promise<ModerationOutcome> {
  if (job.subjectType === "SELLER_REPLY") return processReply(db, provider, job, opts);
  if (job.subjectType !== "REVIEW") return "SKIPPED"; // other subjects arrive with their features
  if ((job.trigger ?? "SUBMISSION") === "USER_REPORT") return "SKIPPED"; // report cases are decided by humans in M4 (AI re-scan is M6)
  const review = await db.review.findUnique({
    where: { id: job.subjectId },
    select: { id: true, status: true, currentVersion: true, publishedVersion: true, rating: true, title: true, body: true },
  }) as { id: string; status: string; currentVersion: number; publishedVersion?: number | null; rating: number; title: string; body: string } | null;
  // Stale/deleted/decided jobs are no-ops. A PUBLISHED review takes the revision path (R2-R4): only a newer, current version qualifies.
  const revision = review?.status === "PUBLISHED" && (job.trigger ?? "SUBMISSION") === "EDIT" && job.version > (review.publishedVersion ?? 0);
  if (!review || review.currentVersion !== job.version || (review.status !== "PENDING" && !revision)) return "SKIPPED";
  const trigger = revision || job.trigger === "EDIT" ? "EDIT" : "SUBMISSION";

  const c = await db.moderationCase.upsert({
    where: { reviewId_version_trigger_seq: { reviewId: review.id, version: job.version, trigger, seq: 1 } },
    create: { reviewId: review.id, version: job.version, trigger },
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

  // ADR-0008: the Verified Buyer label is never set by this job; only a staff proof decision sets it.
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
  if (job.subjectType === "SELLER_REPLY") {
    const reply = await db.sellerReply?.findUnique({ where: { id: job.subjectId }, select: REPLY_SELECT });
    if (!reply || reply.version !== job.version) return false;
    const c = await db.moderationCase.upsert({
      where: { sellerReplyId_version_trigger_seq: { sellerReplyId: reply.id, version: job.version, trigger: "SUBMISSION", seq: 1 } },
      create: { subjectType: "SELLER_REPLY", sellerReplyId: reply.id, version: job.version },
      update: {},
    });
    try {
      await transitionCase(db, { caseId: c.id, to: "NEEDS_HUMAN", actor: { type: "SYSTEM" }, reason: "ai_failure_dead_letter", meta: { jobId, error: error.slice(0, 200) } });
      return true;
    } catch (e) {
      if (e instanceof TransitionConflictError || e instanceof IllegalTransitionError || e instanceof CaseNotFoundError) return false;
      throw e;
    }
  }
  if (job.subjectType !== "REVIEW") return false;
  const review = await db.review.findUnique({
    where: { id: job.subjectId },
    select: { id: true, status: true, currentVersion: true, rating: true, title: true, body: true },
  });
  if (!review || review.currentVersion !== job.version) return false;
  const trigger = job.trigger === "EDIT" ? "EDIT" : "SUBMISSION";
  const c = await db.moderationCase.upsert({
    where: { reviewId_version_trigger_seq: { reviewId: review.id, version: job.version, trigger, seq: 1 } },
    create: { reviewId: review.id, version: job.version, trigger },
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
