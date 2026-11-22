import { CompareError, buildComparison, parseCompareIds, type CompareProductRow } from "@rp/core";
import type { Db } from "./db";
import { HttpError } from "./http";

const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; body: unknown }>();
export const clearCompareCache = () => cache.clear();

/** Cached aggregate columns only: one product query + one seller query, no review scans (TRS-006). */
export async function compare(db: Db, rawIds: string | null, now = Date.now()) {
  let ids: string[];
  try { ids = parseCompareIds(rawIds); }
  catch (e) { if (e instanceof CompareError) throw new HttpError(422, e.code, e.code === "compare_size" ? "Compare 2 to 4 products" : "Products must be distinct"); throw e; }
  const key = [...ids].sort().join(",");
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.body;
  const sel = { id: true, slug: true, name: true, status: true, mergedIntoId: true, categoryId: true, ratingAverage: true, ratingCount: true, verifiedRatingAverage: true, verifiedRatingCount: true, ratingHistogram: true, specs: true, sellerId: true } as const;
  let products = await db.product.findMany({ where: { id: { in: ids } }, select: sel });
  const targets = products.filter((p) => p.status === "MERGED" && p.mergedIntoId && !ids.includes(p.mergedIntoId)).map((p) => p.mergedIntoId!);
  if (targets.length) products = [...products, ...(await db.product.findMany({ where: { id: { in: targets } }, select: sel }))];
  const sellerIds = [...new Set(products.map((p) => p.sellerId).filter((x): x is string => !!x))];
  const sellers = sellerIds.length ? await db.seller.findMany({ where: { id: { in: sellerIds } }, select: { id: true, trustBand: true } }) : [];
  const band = new Map(sellers.map((s) => [s.id, s.trustBand as string]));
  const rows = new Map<string, CompareProductRow>(products.map((p) => [p.id, {
    id: p.id, slug: p.slug, name: p.name, status: p.status, mergedIntoId: p.mergedIntoId, categoryId: p.categoryId,
    ratingAverage: p.ratingAverage === null ? null : Number(p.ratingAverage), ratingCount: p.ratingCount,
    verifiedRatingAverage: p.verifiedRatingAverage === null ? null : Number(p.verifiedRatingAverage), verifiedRatingCount: p.verifiedRatingCount,
    ratingHistogram: (p.ratingHistogram as Record<string, number> | null) ?? null, specs: (p.specs as Record<string, unknown> | null) ?? null, sellerBand: p.sellerId ? band.get(p.sellerId) ?? null : null,
  }]));
  const body = buildComparison(ids, rows);
  cache.set(key, { at: now, body });
  return body;
}
