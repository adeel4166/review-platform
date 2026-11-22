import { recomputeJobId, scoreSeller, scoreUser, voteWeight, type Clock, type SellerInputs, type SignalInput, type TrustBand, type TrustResult, type UserInputs } from "@rp/core";

export interface TrustPort {
  userInputs(userId: string): Promise<(Omit<UserInputs, "signals"> & { signals: SignalInput[]; previousBand: TrustBand; previousScore: number | null }) | null>;
  sellerInputs(sellerId: string): Promise<(Omit<SellerInputs, "signals"> & { signals: SignalInput[]; previousBand: TrustBand; previousScore: number | null }) | null>;
  saveUser(userId: string, r: TrustResult, at: Date, snapshot: boolean): Promise<void>;
  saveSeller(sellerId: string, r: TrustResult, at: Date, snapshot: boolean): Promise<void>;
  /** Re-weight the voter's votes of the last 30 days, recount affected reviews (spec 15.3). */
  reweightVotes(userId: string, weight: number, since: Date): Promise<number>;
}
export interface RecomputeOutcome { subject: string; score: number; band: TrustBand; changed: boolean; reweighted: number }

/** `trust.recompute` (spec 15.3): writes a snapshot only when score or band changed. */
export async function recomputeSubject(p: TrustPort, clock: Clock, subjectKey: string): Promise<RecomputeOutcome | null> {
  const now = clock.now();
  const [kind, id] = [subjectKey.slice(0, 1), subjectKey.slice(2)];
  if (kind === "U") {
    const i = await p.userInputs(id);
    if (!i) return null;
    const r = scoreUser(i, clock);
    const changed = r.band !== i.previousBand || i.previousScore === null || r.score !== i.previousScore;
    await p.saveUser(id, r, now, changed);
    const reweighted = r.band !== i.previousBand ? await p.reweightVotes(id, voteWeight(r.band), new Date(now.getTime() - 30 * 86_400_000)) : 0;
    return { subject: subjectKey, score: r.score, band: r.band, changed, reweighted };
  }
  const i = await p.sellerInputs(id);
  if (!i) return null;
  const r = scoreSeller(i, clock);
  const changed = r.band !== i.previousBand || i.previousScore === null || r.score !== i.previousScore;
  await p.saveSeller(id, r, now, changed);
  return { subject: subjectKey, score: r.score, band: r.band, changed, reweighted: 0 };
}
/** Nightly decay runs the same function over every subject with recent signals (02:00 UTC). */
export async function nightlyDecay(p: TrustPort, clock: Clock, subjects: readonly string[]): Promise<RecomputeOutcome[]> {
  const out: RecomputeOutcome[] = [];
  for (const s of subjects) { const r = await recomputeSubject(p, clock, s); if (r) out.push(r); }
  return out;
}
export { recomputeJobId };
