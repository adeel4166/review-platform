import { IllegalTransitionError, REVIEW_STATUS_FOR, assertTransition, type ModerationState } from "./moderation-state";
import { assertAuditMetadataClean } from "./audit-metadata";

/**
 * DB-backed moderation transitions. Written against a structural client type so core stays free of Prisma;
 * apps pass their PrismaClient via `as unknown as ModerationDb` (see server/moderation.ts, worker/moderation.ts).
 */
export interface CaseRow {
  id: string;
  /** Subject arc (m3b-spec 6.1): exactly one of reviewId / sellerReplyId is set. Absent subjectType means REVIEW. */
  subjectType?: "REVIEW" | "SELLER_REPLY";
  reviewId: string | null;
  sellerReplyId?: string | null;
  version: number;
  state: ModerationState;
  /** Absent means SUBMISSION. EDIT cases on a PUBLISHED review take the revision path (m4-m5-spec 3.2). */
  trigger?: "SUBMISSION" | "EDIT" | "USER_REPORT";
}
export interface ModerationTx {
  moderationCase: {
    findUnique(args: unknown): Promise<CaseRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  review: {
    findUnique(args: unknown): Promise<{ id: string; status: string; authorId?: string; currentVersion: number; rating: number; title: string; body: string } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  reviewRevision: {
    updateMany(args: unknown): Promise<{ count: number }>;
    /** Needed to copy an approved revision onto a PUBLISHED review (R2/R5). */
    findFirst?(args: unknown): Promise<{ rating: number; title: string; body: string; incentive?: string } | null>;
  };
  /** Optional: media versions (m4-m5-spec 3.4). An asset not READY when its version is approved is detached in that version. */
  mediaAsset?: { updateMany(args: unknown): Promise<{ count: number }>; findMany?(args: unknown): Promise<{ id: string }[]> };
  outboxEvent?: { create(args: unknown): Promise<unknown> };
  /** Only needed for SELLER_REPLY cases. */
  sellerReply?: {
    findUnique(args: unknown): Promise<{ id: string; authorId?: string; status: string; version: number } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  auditLog: { create(args: unknown): Promise<unknown> };
}
export interface ModerationDb extends ModerationTx {
  $transaction<T>(fn: (tx: ModerationTx) => Promise<T>): Promise<T>;
}

export type Actor =
  | { type: "AI"; id?: null; provider: string }
  | { type: "SYSTEM"; id?: null }
  | { type: "STAFF"; id: string };

export interface TransitionInput {
  caseId: string;
  to: ModerationState;
  actor: Actor;
  reason?: string;
  ai?: { score: number; confidence: number; reasons: string[]; provider: string };
  /** Extra audit metadata (e.g. job id). */
  meta?: Record<string, unknown>;
}

export class CaseNotFoundError extends Error {
  constructor() {
    super("Moderation case not found");
    this.name = "CaseNotFoundError";
  }
}
/** Separation of duties: staff may not decide a case for their own review. */
export class SelfDecisionError extends Error {
  constructor() {
    super("You cannot moderate your own review");
    this.name = "SelfDecisionError";
  }
}
/** Another actor changed the case first (conditional update matched 0 rows). */
export class TransitionConflictError extends Error {
  constructor() {
    super("Moderation case changed concurrently");
    this.name = "TransitionConflictError";
  }
}

const REPLY_AUDIT_ACTION: Record<ModerationState, string> = {
  PENDING: "seller_reply.moderation_reset",
  AI_REVIEW: "seller_reply.ai_review_start",
  NEEDS_HUMAN: "seller_reply.hold",
  APPROVED: "seller_reply.approve",
  REJECTED: "seller_reply.reject",
  SUPERSEDED: "seller_reply.superseded",
};

const AUDIT_ACTION: Record<ModerationState, string> = {
  PENDING: "review.moderation_reset",
  AI_REVIEW: "review.ai_review_start",
  NEEDS_HUMAN: "review.hold",
  APPROVED: "review.approve",
  REJECTED: "review.reject",
  SUPERSEDED: "review.case_superseded",
};

const REVISION_AUDIT_ACTION: Partial<Record<ModerationState, string>> = {
  AI_REVIEW: "review.revision_ai_start",
  NEEDS_HUMAN: "review.revision_auto_hold",
  APPROVED: "review.revision_approve",
  REJECTED: "review.revision_reject",
};

/**
 * Single entry point for every state change. In one transaction: validate, conditionally update the case
 * (first commit wins), mirror the review status, and write one audit row.
 */
export async function transitionCase(db: ModerationDb, input: TransitionInput): Promise<CaseRow> {
  return db.$transaction(async (tx) => {
    const c = await tx.moderationCase.findUnique({ where: { id: input.caseId } });
    if (!c) throw new CaseNotFoundError();
    assertTransition(c.state, input.to); // throws IllegalTransitionError
    // Humans only decide cases escalated to them; AI_REVIEW belongs to the worker.
    if (input.actor.type === "STAFF" && c.state !== "NEEDS_HUMAN") throw new IllegalTransitionError(c.state, input.to);

    const isReply = c.subjectType === "SELLER_REPLY";
    if (isReply && (!c.sellerReplyId || !tx.sellerReply)) throw new CaseNotFoundError();
    if (input.actor.type === "STAFF") {
      const own = isReply
        ? await tx.sellerReply!.findUnique({ where: { id: c.sellerReplyId }, select: { id: true, authorId: true } })
        : await tx.review.findUnique({ where: { id: c.reviewId }, select: { id: true, authorId: true } });
      if (own?.authorId && own.authorId === input.actor.id) throw new SelfDecisionError();
    }

    // Revision path (R2-R6): an EDIT case on a PUBLISHED review never changes the review status; the live text stays until approval.
    const liveReview = !isReply && c.trigger === "EDIT" ? await tx.review.findUnique({ where: { id: c.reviewId }, select: { id: true, status: true, authorId: true, currentVersion: true, rating: true, title: true, body: true } }) : null;
    const isRevision = liveReview?.status === "PUBLISHED";

    const now = new Date();
    const terminal = input.to === "APPROVED" || input.to === "REJECTED" || input.to === "SUPERSEDED";
    const res = await tx.moderationCase.updateMany({
      where: { id: c.id, state: c.state },
      data: {
        state: input.to,
        ...(input.ai
          ? { aiScore: input.ai.score, aiConfidence: input.ai.confidence, aiReasons: input.ai.reasons, aiProvider: input.ai.provider }
          : {}),
        ...(input.reason !== undefined ? { decisionReason: input.reason } : {}),
        ...(input.actor.type === "STAFF" ? { decidedById: input.actor.id } : {}),
        ...(terminal ? { decidedAt: now } : {}),
      },
    });
    if (res.count !== 1) throw new TransitionConflictError();

    const status = REVIEW_STATUS_FOR[input.to];
    if (isRevision) {
      const revStatus = input.to === "APPROVED" ? "APPROVED" : input.to === "REJECTED" ? "REJECTED" : input.to === "NEEDS_HUMAN" ? "HELD" : input.to === "SUPERSEDED" ? "SUPERSEDED" : null;
      if (input.to === "APPROVED") {
        const rev = await tx.reviewRevision.findFirst?.({ where: { reviewId: c.reviewId, version: c.version }, select: { rating: true, title: true, body: true, incentive: true } });
        if (!rev) throw new TransitionConflictError();
        const r = await tx.review.updateMany({
          where: { id: c.reviewId, currentVersion: c.version, status: "PUBLISHED" },
          data: { rating: rev.rating, title: rev.title, body: rev.body, ...(rev.incentive ? { incentive: rev.incentive } : {}), publishedVersion: c.version, editedAt: now },
        });
        if (r.count !== 1) throw new TransitionConflictError();
        // Assets still not READY at approval are detached in this version so unreviewed media can never become public later.
        await tx.mediaAsset?.updateMany({ where: { reviewId: c.reviewId, attachedInVersion: { lte: c.version }, detachedInVersion: null, status: { not: "READY" } }, data: { detachedInVersion: c.version } });
      }
      if (revStatus) await tx.reviewRevision.updateMany({ where: { reviewId: c.reviewId, version: c.version, status: { in: ["PENDING", "HELD"] } }, data: { status: revStatus } });
    } else if (input.to === "SUPERSEDED") {
      // Superseded cases never touch the content (a newer revision/edit owns it).
    } else if (isReply && status && input.to !== "PENDING" && input.to !== "AI_REVIEW") {
      const r = await tx.sellerReply!.updateMany({
        // Guard on version: an edit has its own case; a stale decision must not publish or hide the newer text (m3b-spec 5.3).
        where: { id: c.sellerReplyId, version: c.version, status: { in: ["PENDING", "HIDDEN"] } },
        data: { status, ...(input.to === "APPROVED" ? { publishedAt: now } : {}) },
      });
      if (r.count !== 1) throw new TransitionConflictError();
    } else if (status && input.to !== "PENDING" && input.to !== "AI_REVIEW") {
      const r = await tx.review.updateMany({
        // Guard on version: a newer revision has its own case; a stale decision must not touch the review.
        where: { id: c.reviewId, currentVersion: c.version, status: { in: ["PENDING", "HIDDEN"] } },
        data: {
          status,
          ...(input.to === "APPROVED" ? { publishedAt: now, publishedVersion: c.version } : {}),
        },
      });
      if (r.count !== 1) throw new TransitionConflictError();
      await tx.reviewRevision.updateMany({
        where: { reviewId: c.reviewId, version: c.version },
        data: { status: input.to === "APPROVED" ? "APPROVED" : input.to === "REJECTED" ? "REJECTED" : "HELD" },
      });
    }

    // M5 (MED-037): only an approval can make media public. One promote request per READY asset visible in the approved version;
    // `media.promote` re-reads the case itself, so a stale or duplicate event is a no-op.
    if (input.to === "APPROVED" && !isReply) {
      const visible = (await tx.mediaAsset?.findMany?.({ where: { reviewId: c.reviewId, status: "READY", bucket: "PRIVATE", attachedInVersion: { lte: c.version }, OR: [{ detachedInVersion: null }, { detachedInVersion: { gt: c.version } }] }, select: { id: true } })) ?? [];
      for (const m of visible) await tx.outboxEvent?.create({ data: { type: "media.promote_requested", aggregateId: m.id, payload: { assetId: m.id, caseId: c.id } } });
    }

    const metadata = { caseId: c.id, version: c.version, from: c.state, to: input.to, reason: input.reason ?? null, ...input.meta };
    assertAuditMetadataClean(metadata);
    await tx.auditLog.create({
      data: {
        actorType: input.actor.type,
        actorId: input.actor.id ?? null,
        action: isReply ? REPLY_AUDIT_ACTION[input.to] : (isRevision ? REVISION_AUDIT_ACTION[input.to] : undefined) ?? AUDIT_ACTION[input.to],
        entityType: isReply ? "SellerReply" : "Review",
        entityId: (isReply ? c.sellerReplyId : c.reviewId) as string,
        metadata,
      },
    });
    return { ...c, state: input.to };
  });
}

export { IllegalTransitionError };
