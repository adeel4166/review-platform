import { systemClock } from "@rp/core";
import type { Db } from "./db";

export interface HomeStats {
  verifiedReviews: number; productsReviewed: number; reviewsPublished: number;
  averageRating: number | null; asOf: string;
}
export interface HomeCategory { id: string; slug: string; name: string; count: number }

/** Real aggregates only (no fabricated numbers): published reviews, verified-purchase reviews, products that have reviews. */
export async function getHomeStats(db: Db): Promise<HomeStats | null> {
  try {
    const [reviewsPublished, verifiedReviews, productsReviewed, avg] = await Promise.all([
      db.review.count({ where: { status: "PUBLISHED" } }),
      db.review.count({ where: { status: "PUBLISHED", verifiedPurchaseAt: { not: null } } }),
      db.product.count({ where: { status: "ACTIVE", reviewCount: { gt: 0 } } }),
      db.review.aggregate({ where: { status: "PUBLISHED" }, _avg: { rating: true } }),
    ]);
    return { reviewsPublished, verifiedReviews, productsReviewed, averageRating: avg._avg.rating ?? null, asOf: systemClock.now().toISOString().slice(0, 10) };
  } catch { return null; }
}

/** Top-level categories with their ACTIVE product counts, biggest first (the first one is the "featured" tile). */
export async function listCategoryCounts(db: Db, take = 7): Promise<HomeCategory[]> {
  try {
    const rows = await db.category.findMany({ select: { id: true, slug: true, name: true, _count: { select: { products: { where: { status: "ACTIVE" } } } } } });
    return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, count: r._count.products }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, take);
  } catch { return []; }
}
