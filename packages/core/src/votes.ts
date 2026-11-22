import { systemClock } from "./clock";
/** Helpful / not-helpful votes (m4-m5-spec 2). Pure rules, no I/O. */
export type VoteValue = "HELPFUL" | "NOT_HELPFUL";
export type VoteDeny = "SELF_VOTE" | "CONFLICT_OF_INTEREST" | "VOTING_RESTRICTED" | "EMAIL_NOT_VERIFIED" | "NOT_FOUND";

export const VOTE_NEW_ACCOUNT_DAYS = 7;
export const VOTE_LIMIT_PER_HOUR = 60;
export const VOTE_LIMIT_PER_HOUR_NEW = 20;
export const VOTE_LIMIT_IP_PER_HOUR = 300;

/** Order matters: a missing/non-public review is the same 404 for everyone (AZ-022) and is checked first. */
export function authorizeVote(ctx: {
  callerId: string;
  emailVerified: boolean;
  votingRestricted: boolean;
  review: { authorId: string; status: string; sellerId: string | null } | null;
  callerSellerIds: readonly string[];
}): { ok: true } | { ok: false; deny: VoteDeny } {
  if (!ctx.review || ctx.review.status !== "PUBLISHED") return { ok: false, deny: "NOT_FOUND" };
  if (!ctx.emailVerified) return { ok: false, deny: "EMAIL_NOT_VERIFIED" };
  if (ctx.review.authorId === ctx.callerId) return { ok: false, deny: "SELF_VOTE" };
  if (ctx.review.sellerId && ctx.callerSellerIds.includes(ctx.review.sellerId)) return { ok: false, deny: "CONFLICT_OF_INTEREST" };
  if (ctx.votingRestricted) return { ok: false, deny: "VOTING_RESTRICTED" };
  return { ok: true };
}

/** Delta of the cached counters for (old -> new). Always relative, never read-modify-write. */
export function voteDelta(prev: VoteValue | null, next: VoteValue | null): { h: -1 | 0 | 1; n: -1 | 0 | 1 } {
  const h = (next === "HELPFUL" ? 1 : 0) - (prev === "HELPFUL" ? 1 : 0);
  const n = (next === "NOT_HELPFUL" ? 1 : 0) - (prev === "NOT_HELPFUL" ? 1 : 0);
  return { h: h as -1 | 0 | 1, n: n as -1 | 0 | 1 };
}

/** NEW account = created less than VOTE_NEW_ACCOUNT_DAYS days ago (D-A3). */
export const isNewAccount = (createdAt: Date, now = systemClock.now()): boolean =>
  now.getTime() - createdAt.getTime() < VOTE_NEW_ACCOUNT_DAYS * 86_400_000;
