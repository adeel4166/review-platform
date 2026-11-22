import { t } from "@/i18n/en";
import { Stars } from "../Stars";
import { HistogramBar } from "./HistogramBar";

/** Parses the cached `ratingHistogram` JSON ({"1":n..."5":n}); anything unexpected yields zeros. */
export function parseHistogram(raw: unknown): Record<1 | 2 | 3 | 4 | 5, number> {
  const out = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const k of [1, 2, 3, 4, 5] as const) {
      const v = Number((raw as Record<string, unknown>)[String(k)]);
      if (Number.isFinite(v) && v > 0) out[k] = Math.floor(v);
    }
  }
  return out;
}

/** Summary + 5→1 distribution. Every bar has a text count, so it is not colour-only. */
export function RatingHistogram({ average, count, histogram }: { average: number | null; count: number; histogram: unknown }) {
  const h = parseHistogram(histogram);
  const total = Object.values(h).reduce((a, b) => a + b, 0) || count;
  return (
    <section aria-labelledby="rating-dist" className="grid gap-6 rounded-lg border border-border bg-surface p-4 shadow-sm md:grid-cols-[12rem_1fr] md:p-6" data-testid="rating-histogram">
      <div>
        <h2 id="rating-dist" className="sr-only">{t("histogram.title")}</h2>
        <p className="text-4xl font-bold tabular-nums"><bdi>{average !== null && count > 0 ? average.toFixed(1) : "–"}</bdi></p>
        {average !== null && count > 0 && <Stars value={average} />}
        <p className="mt-1 text-sm text-text-muted">{t("histogram.basedOn", { count })}</p>
      </div>
      <ol className="space-y-2">
        {([5, 4, 3, 2, 1] as const).map((s) => {
          const pct = total > 0 ? Math.round((h[s] / total) * 100) : 0;
          return (
            <li key={s} className="flex items-center gap-3 text-sm">
              <span className="w-12 shrink-0 tabular-nums">{t("histogram.row", { n: s })}</span>
              <HistogramBar pct={pct} />
              <span className="w-24 shrink-0 text-right tabular-nums text-text-muted">{t("histogram.count", { count: h[s], pct })}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
