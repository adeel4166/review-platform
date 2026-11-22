import { NearDuplicateIndex, detectProductBurst, lshBuckets, minhash, type BurstReview, type BurstState, type Clock, type TrustBand } from "@rp/core";

/** Persistence for burst routing (Prisma adapter over reviews / product_bursts; in-memory in tests). */
export interface BurstPort {
  /** Reviews on the product created in the last 60 minutes, with author band. */
  recentReviews(productId: string, since: Date): Promise<BurstReview[]>;
  openBurst(productId: string, now: Date): Promise<(BurstState & { id: string }) | null>;
  /** Insert or extend. Returns the burst id and whether it was newly opened (-> `product.burst_opened`). */
  saveBurst(productId: string, state: BurstState, existingId?: string): Promise<{ id: string; opened: boolean }>;
}
export interface RoutingResult { extraForceUnsure: string[]; burstId?: string; burstOpened?: boolean; nearDuplicateOf?: string[] }

/**
 * Called by `moderation.assess` step 1 for REVIEW targets (spec 16.3/16.4). Returns reasons that make classify() force UNSURE, so the
 * case ends in lane HOLD (human) and never auto-publishes (TRS-004).
 */
export async function routeReview(p: { burst: BurstPort; dup?: { index: NearDuplicateIndex } }, clock: Clock, r: { productId: string; reviewId: string; authorId: string; text: string }): Promise<RoutingResult> {
  const now = clock.now();
  const out: RoutingResult = { extraForceUnsure: [] };
  const recent = await p.burst.recentReviews(r.productId, new Date(now.getTime() - 3_600_000));
  const verdict = detectProductBurst(recent, now, await p.burst.openBurst(r.productId, now));
  if (verdict.burst && verdict.state) {
    const existing = await p.burst.openBurst(r.productId, now);
    const saved = await p.burst.saveBurst(r.productId, verdict.state, existing?.id);
    out.extraForceUnsure.push("PRODUCT_BURST"); out.burstId = saved.id; out.burstOpened = saved.opened;
  }
  if (p.dup) {
    const sig = minhash(r.text);
    const hits = p.dup.index.query({ reviewId: r.reviewId, authorId: r.authorId, sig });
    p.dup.index.add({ reviewId: r.reviewId, authorId: r.authorId, sig });
    if (hits.length) { out.extraForceUnsure.push("NEAR_DUPLICATE"); out.nearDuplicateOf = hits.map((h) => h.reviewId); }
  }
  return out;
}
export { lshBuckets };

/** `trust.product-burst` (spec 16.4): exclude the window's already PUBLISHED reviews from aggregates and bump post-review priority. */
export interface BurstExcludePort {
  excludePublishedInWindow(productId: string, from: Date, to: Date, at: Date): Promise<string[]>;
  bumpPostReview(reviewIds: readonly string[], by: number): Promise<void>;
}
export async function applyBurst(p: BurstExcludePort, clock: Clock, productId: string, state: BurstState): Promise<string[]> {
  const ids = await p.excludePublishedInWindow(productId, new Date(state.startedAt.getTime() - 3_600_000), state.endsAt, clock.now());
  if (ids.length) await p.bumpPostReview(ids, 100);
  return ids;
}
export type { TrustBand };
