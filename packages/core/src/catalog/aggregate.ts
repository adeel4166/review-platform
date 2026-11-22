import { roundHalfEven } from "../trust/score";

export interface AggReview { rating: number; status: string; verifiedPurchaseAt: Date | null; aggregateExcludedAt: Date | null }
export interface Aggregate {
  ratingAverage: number | null; ratingCount: number; verifiedRatingAverage: number | null; verifiedRatingCount: number;
  ratingHistogram: Record<"1" | "2" | "3" | "4" | "5", number>;
}
/** Recompute from scratch (spec 16.5): only PUBLISHED and not burst-excluded; order-independent; rounding in TS, half-even. */
export function aggregate(reviews: readonly AggReview[]): Aggregate {
  const counted = reviews.filter((r) => r.status === "PUBLISHED" && !r.aggregateExcludedAt);
  const hist = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  let sum = 0, vsum = 0, vn = 0;
  for (const r of counted) {
    hist[String(r.rating) as keyof typeof hist]++;
    sum += r.rating;
    if (r.verifiedPurchaseAt) { vsum += r.rating; vn++; }
  }
  return {
    ratingAverage: counted.length ? roundHalfEven(sum / counted.length) : null, ratingCount: counted.length,
    verifiedRatingAverage: vn ? roundHalfEven(vsum / vn) : null, verifiedRatingCount: vn, ratingHistogram: hist,
  };
}
export const aggregateJobId = (productId: string, eventId: string) => `agg__${productId}__${eventId}`;
