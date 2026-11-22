import type { TrustBand } from "./weights";

export const BURST = { perProductPerHour: 10, lowTrustPerProductPerHour: 5, windowMinutes: 60 } as const;
export interface BurstReview { id: string; createdAt: Date; authorBand: TrustBand }
export interface BurstState { startedAt: Date; lastReviewAt: Date; endsAt: Date; reviewCount: number; lowTrustCount: number }
export interface BurstVerdict { burst: boolean; reviewCount: number; lowTrustCount: number; state?: BurstState; forceUnsure?: "PRODUCT_BURST" }

/** Sliding 60-minute window on the injected clock (spec 16.4). Above either threshold -> open/extend a burst and force-UNSURE. */
export function detectProductBurst(reviews: readonly BurstReview[], now: Date, open: BurstState | null, cfg: typeof BURST = BURST): BurstVerdict {
  const from = now.getTime() - cfg.windowMinutes * 60_000;
  const win = reviews.filter((r) => r.createdAt.getTime() > from && r.createdAt.getTime() <= now.getTime());
  const low = win.filter((r) => r.authorBand === "NEW" || r.authorBand === "LOW").length;
  const tripped = win.length > cfg.perProductPerHour || low > cfg.lowTrustPerProductPerHour;
  const continuing = !!open && open.endsAt.getTime() > now.getTime();
  if (!tripped && !continuing) return { burst: false, reviewCount: win.length, lowTrustCount: low };
  const last = win.reduce((m, r) => (r.createdAt > m ? r.createdAt : m), now);
  const state: BurstState = {
    startedAt: open && continuing ? open.startedAt : new Date(Math.min(...win.map((r) => r.createdAt.getTime()), now.getTime())),
    lastReviewAt: last,
    endsAt: new Date(last.getTime() + cfg.windowMinutes * 60_000),
    reviewCount: Math.max(win.length, open && continuing ? open.reviewCount : 0),
    lowTrustCount: Math.max(low, open && continuing ? open.lowTrustCount : 0),
  };
  return { burst: true, reviewCount: win.length, lowTrustCount: low, state, forceUnsure: "PRODUCT_BURST" };
}
