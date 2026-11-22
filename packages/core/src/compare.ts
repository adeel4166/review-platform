export const COMPARE_MIN = 2, COMPARE_MAX = 4, LOW_SAMPLE = 50;
export class CompareError extends Error { constructor(public code: "compare_size" | "compare_duplicate") { super(code); } }

export function parseCompareIds(raw: string | null | undefined): string[] {
  const ids = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new CompareError("compare_duplicate");
  if (ids.length < COMPARE_MIN || ids.length > COMPARE_MAX) throw new CompareError("compare_size");
  return ids;
}
export interface CompareProductRow {
  id: string; slug: string; name: string; status: string; mergedIntoId: string | null; categoryId: string; imageUrl?: string | null;
  ratingAverage: number | null; ratingCount: number; verifiedRatingAverage: number | null; verifiedRatingCount: number;
  ratingHistogram: Record<string, number> | null; specs: Record<string, unknown> | null; sellerBand: string | null;
}
export type CompareItem = { id: string; unavailable: true } | {
  id: string; slug: string; name: string; image: string | null; mergedFrom?: string;
  ratingAverage: number | null; ratingCount: number; verifiedRatingAverage: number | null; verifiedRatingCount: number;
  histogramPct: Record<string, number>; verifiedShare: number; lowSample: boolean; specs: Record<string, unknown>; sellerBand: string | null; categoryId: string;
  best: string[];
};
/** Spec keys with a declared direction ("higher" or "lower" is better); others get no best marker. */
export const SPEC_DIRECTION: Readonly<Record<string, "higher" | "lower">> = { battery_wh: "higher", weight_g: "lower", warranty_months: "higher", price: "lower" };

const pct = (h: Record<string, number> | null, total: number) => Object.fromEntries(["1", "2", "3", "4", "5"].map((k) => [k, total ? Math.round(((h?.[k] ?? 0) / total) * 1000) / 10 : 0]));

/** Pure builder: no review scans, only cached columns (TRS-006). `resolve` maps a MERGED id to its target row. */
export function buildComparison(requested: readonly string[], rows: ReadonlyMap<string, CompareProductRow>): { items: CompareItem[]; categoriesDiffer: boolean } {
  const items: CompareItem[] = requested.map((id): CompareItem => {
    let row = rows.get(id), mergedFrom: string | undefined;
    if (row?.status === "MERGED" && row.mergedIntoId) { mergedFrom = id; row = rows.get(row.mergedIntoId); }
    if (!row || row.status !== "ACTIVE") return { id, unavailable: true };
    return {
      id: row.id, slug: row.slug, name: row.name, image: row.imageUrl ?? null, ...(mergedFrom ? { mergedFrom } : {}),
      ratingAverage: row.ratingAverage, ratingCount: row.ratingCount, verifiedRatingAverage: row.verifiedRatingAverage, verifiedRatingCount: row.verifiedRatingCount,
      histogramPct: pct(row.ratingHistogram, row.ratingCount), verifiedShare: row.ratingCount ? Math.round((row.verifiedRatingCount / row.ratingCount) * 1000) / 10 : 0,
      lowSample: row.ratingCount < LOW_SAMPLE, specs: row.specs ?? {}, sellerBand: row.sellerBand, categoryId: row.categoryId, best: [],
    };
  });
  const avail = items.filter((i): i is Exclude<CompareItem, { unavailable: true }> => !("unavailable" in i));
  for (const [key, dir] of Object.entries(SPEC_DIRECTION)) {
    const vals = avail.map((i) => ({ i, v: i.specs[key] })).filter((x): x is { i: typeof x.i; v: number } => typeof x.v === "number");
    if (vals.length < 2) continue;
    const best = dir === "higher" ? Math.max(...vals.map((x) => x.v)) : Math.min(...vals.map((x) => x.v));
    for (const x of vals) if (x.v === best) x.i.best.push(key);
  }
  return { items, categoriesDiffer: new Set(avail.map((i) => i.categoryId)).size > 1 };
}
