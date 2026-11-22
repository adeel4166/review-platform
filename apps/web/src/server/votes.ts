import { authorizeVote, isNewAccount, voteDelta, type VoteValue } from "@rp/core";
import type { Db } from "./db";
import { HttpError } from "./http";

export interface VoteResult { value: VoteValue | null; helpfulCount: number; notHelpfulCount: number }
export interface VoteCtx {
  ipHash?: string | null;
  now?: Date;
  /** Charged only when the write actually changes something (a same-value PUT is a free no-op). */
  charge?: (a: { newAccount: boolean }) => Promise<void>;
}

const DENY: Record<string, [number, string, string]> = {
  SELF_VOTE: [403, "SELF_VOTE", "You cannot vote on your own review"],
  CONFLICT_OF_INTEREST: [403, "CONFLICT_OF_INTEREST", "Members of the seller cannot vote on its reviews"],
  VOTING_RESTRICTED: [403, "VOTING_RESTRICTED", "Voting is restricted on your account"],
  EMAIL_NOT_VERIFIED: [403, "EMAIL_NOT_VERIFIED", "Verify your email address first"],
  NOT_FOUND: [404, "not_found", "Review not found"],
};

/** Shared authorisation: loads the review (+ seller scope), the caller and any active VOTING_RESTRICTION. */
async function authorise(db: Db, userId: string, reviewId: string, now: Date) {
  const [review, user, restriction, memberships] = await Promise.all([
    db.review.findUnique({ where: { id: reviewId }, select: { id: true, authorId: true, status: true, helpfulCount: true, notHelpfulCount: true, product: { select: { sellerId: true } } } }),
    db.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true, createdAt: true, status: true } }),
    db.enforcementAction.findFirst({ where: { subjectUserId: userId, type: "VOTING_RESTRICTION", status: "ACTIVE" }, select: { endsAt: true } }),
    db.sellerMember.findMany({ where: { userId }, select: { sellerId: true } }),
  ]);
  const restricted = !!restriction && (!restriction.endsAt || restriction.endsAt > now);
  const verdict = authorizeVote({
    callerId: userId,
    emailVerified: !!user?.emailVerifiedAt && (user.status ?? "ACTIVE") === "ACTIVE",
    votingRestricted: restricted,
    review: review ? { authorId: review.authorId, status: review.status, sellerId: review.product?.sellerId ?? null } : null,
    callerSellerIds: memberships.map((m) => m.sellerId),
  });
  if (!verdict.ok) {
    const [status, code, msg] = DENY[verdict.deny]!;
    throw new HttpError(status, code, msg);
  }
  return { review: review!, newAccount: user?.createdAt ? isNewAccount(user.createdAt, now) : true };
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * PUT: set or switch a vote. Counter updates are relative increments in the same transaction (VOT-003).
 * SEC-M4-02: the previous vote is (re-)read INSIDE the transaction and the row change is conditional on it, so two concurrent
 * identical PUTs apply the counter delta once (the loser is a no-op) and a concurrent first vote is not a 500.
 */
export async function putVote(db: Db, userId: string, reviewId: string, value: VoteValue, ctx: VoteCtx = {}): Promise<VoteResult> {
  const now = ctx.now ?? new Date();
  const { review, newAccount } = await authorise(db, userId, reviewId, now);
  const pre = await db.reviewVote.findUnique({ where: { reviewId_userId: { reviewId, userId } }, select: { value: true } });
  if (pre?.value === value) return { value, helpfulCount: review.helpfulCount, notHelpfulCount: review.notHelpfulCount };
  await ctx.charge?.({ newAccount });
  return db.$transaction(async (tx) => {
    const current = async (v: VoteValue | null): Promise<VoteResult> => {
      const r = await tx.review.findUniqueOrThrow({ where: { id: reviewId }, select: { helpfulCount: true, notHelpfulCount: true } });
      return { value: v, ...r };
    };
    const prev = await tx.reviewVote.findUnique({ where: { reviewId_userId: { reviewId, userId } }, select: { value: true } });
    if (prev?.value === value) return current(value); // a concurrent identical PUT already applied
    if (prev) {
      const res = await tx.reviewVote.updateMany({ where: { reviewId, userId, value: prev.value }, data: { value, ipHash: ctx.ipHash ?? null } });
      if (res.count !== 1) return current(null); // lost a race with another switch or retract: apply nothing
    } else {
      try { await tx.reviewVote.create({ data: { reviewId, userId, value, ipHash: ctx.ipHash ?? null } }); }
      catch (e) { if (isUniqueViolation(e)) return current(null); throw e; } // concurrent first vote
    }
    const d = voteDelta(prev?.value ?? null, value);
    const r = await tx.review.update({ where: { id: reviewId }, data: { helpfulCount: { increment: d.h }, notHelpfulCount: { increment: d.n } }, select: { helpfulCount: true, notHelpfulCount: true } });
    return { value, ...r };
  });
}

/** DELETE: retract (also when there was no vote). */
export async function deleteVote(db: Db, userId: string, reviewId: string, ctx: VoteCtx = {}): Promise<VoteResult> {
  const now = ctx.now ?? new Date();
  const { review, newAccount } = await authorise(db, userId, reviewId, now);
  const prev = await db.reviewVote.findUnique({ where: { reviewId_userId: { reviewId, userId } }, select: { value: true } });
  if (!prev) return { value: null, helpfulCount: review.helpfulCount, notHelpfulCount: review.notHelpfulCount };
  await ctx.charge?.({ newAccount });
  return db.$transaction(async (tx) => {
    const res = await tx.reviewVote.deleteMany({ where: { reviewId, userId, value: prev.value } });
    if (res.count !== 1) return { value: null as VoteValue | null, helpfulCount: review.helpfulCount, notHelpfulCount: review.notHelpfulCount }; // lost a race with another retract
    const d = voteDelta(prev.value, null);
    const r = await tx.review.update({ where: { id: reviewId }, data: { helpfulCount: { increment: d.h }, notHelpfulCount: { increment: d.n } }, select: { helpfulCount: true, notHelpfulCount: true } });
    return { value: null as VoteValue | null, ...r };
  });
}

/** The caller's own vote for a set of reviews (DTO `myVote`). Never returns anyone else's vote. */
export async function myVotes(db: Db, userId: string | null, reviewIds: string[]): Promise<Map<string, VoteValue>> {
  if (!userId || reviewIds.length === 0) return new Map();
  const rows = await db.reviewVote.findMany({ where: { userId, reviewId: { in: reviewIds } }, select: { reviewId: true, value: true } });
  return new Map(rows.map((r) => [r.reviewId, r.value]));
}
