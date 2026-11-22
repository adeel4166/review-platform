import { MATURITY, VOTE_WEIGHT, type TrustBand } from "./weights";

/** Vote weight at write time from the voter's band (TRS-001). A voter failing any maturity gate is NEW -> 0. */
export const voteWeight = (band: TrustBand): number => VOTE_WEIGHT[band];

export interface MaturityInput { createdAt: Date; emailVerified: boolean; qualifyingActions: number }
export function maturityGates(i: MaturityInput, now: Date) {
  const ageOk = now.getTime() - i.createdAt.getTime() >= MATURITY.minAgeDays * 86_400_000;
  const emailOk = i.emailVerified, actionsOk = i.qualifyingActions >= MATURITY.minActions;
  return { ageOk, emailOk, actionsOk, mature: ageOk && emailOk && actionsOk };
}

export interface CountedVote { value: "HELPFUL" | "NOT_HELPFUL"; weight: number; frozen: boolean }
/** Counted votes: weight > 0 and not frozen. Weighted net feeds ranking. */
export function countVotes(votes: readonly CountedVote[]) {
  let helpfulCount = 0, notHelpfulCount = 0, net = 0;
  for (const v of votes) {
    if (v.weight <= 0 || v.frozen) continue;
    if (v.value === "HELPFUL") { helpfulCount++; net += v.weight; } else { notHelpfulCount++; net -= v.weight; }
  }
  return { helpfulCount, notHelpfulCount, helpfulWeighted: Math.round(net * 100) / 100 };
}

/**
 * SEC-M7-04: a vote written while >= `perIpDay` other accounts already voted on the review from the same ipHash in 24 h carries weight 0
 * (the stored weight is the source of truth, so the 90-day `RET-IPHASH` nulling never changes a counted vote). A missing ipHash applies no penalty.
 */
export function sharedIpWeight(weight: number, otherVotesFromSameIpIn24h: number, cfg: { perIpDay: number } = VOTE_FREEZE): number {
  return otherVotesFromSameIpIn24h >= cfg.perIpDay ? 0 : weight;
}

/** Re-weight window after a voter's band changes (spec 15.3). */
export const REWEIGHT_DAYS = 30;
export function reweight<T extends { weight: number; createdAt: Date }>(votes: readonly T[], band: TrustBand, now: Date): T[] {
  const cutoff = now.getTime() - REWEIGHT_DAYS * 86_400_000;
  return votes.map((v) => (v.createdAt.getTime() >= cutoff ? { ...v, weight: voteWeight(band) } : v));
}

export const VOTE_FREEZE = { perHour: 20, lowTrustShare: 0.5, lowTrustMinVotes: 10, perIpDay: 3 } as const;
export interface RecentVote { at: Date; band: TrustBand; ipHash?: string | null }
export type FreezeReason = "VOTES_PER_HOUR" | "LOW_TRUST_SHARE" | "SHARED_IP";
/** Sliding-window velocity check on the injected clock (spec 16.2). Returns the first tripped trigger or null. */
export function detectVoteAnomaly(votes: readonly RecentVote[], now: Date, cfg: typeof VOTE_FREEZE = VOTE_FREEZE): FreezeReason | null {
  const t = now.getTime();
  const hour = votes.filter((v) => t - v.at.getTime() <= 3_600_000 && v.at.getTime() <= t);
  if (hour.length > cfg.perHour) return "VOTES_PER_HOUR";
  const day = votes.filter((v) => t - v.at.getTime() <= 86_400_000 && v.at.getTime() <= t);
  if (day.length >= cfg.lowTrustMinVotes && day.filter((v) => v.band === "NEW" || v.band === "LOW").length / day.length > cfg.lowTrustShare) return "LOW_TRUST_SHARE";
  const ips = new Map<string, number>();
  for (const v of day) if (v.ipHash) ips.set(v.ipHash, (ips.get(v.ipHash) ?? 0) + 1);
  if ([...ips.values()].some((n) => n >= cfg.perIpDay)) return "SHARED_IP";
  return null;
}
