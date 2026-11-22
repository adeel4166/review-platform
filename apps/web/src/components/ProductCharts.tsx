"use client";

import { t } from "@/i18n/en";
import { parseHistogram } from "./ui/RatingHistogram";

/** Dependency-free SVG/CSS charts (no chart library in the bundle). Every value is also available as text. */
export function RatingDistributionChart({ histogram, count }: { histogram: unknown; count: number }) {
  const h = parseHistogram(histogram);
  const total = Object.values(h).reduce((a, b) => a + b, 0) || count;
  const max = Math.max(1, ...Object.values(h));
  const W = 300, H = 120, bw = 36, gap = (W - bw * 5) / 4;
  const stars = [1, 2, 3, 4, 5] as const;
  return (
    <figure data-testid="chart-distribution" className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <figcaption className="font-semibold">{t("charts.distribution")}</figcaption>
      <svg role="img" aria-label={`${t("charts.distribution.desc")}: ${[5, 4, 3, 2, 1].map((s) => t("histogram.count", { count: h[s as 1], pct: total ? Math.round((h[s as 1] / total) * 100) : 0 }) + " " + t("histogram.row", { n: s })).join(", ")}`} viewBox={`0 0 ${W} ${H + 22}`} className="mt-2 w-full">
        {stars.map((s, i) => {
          const bh = (h[s] / max) * H;
          const x = i * (bw + gap);
          return (
            <g key={s}>
              <rect x={x} y={H - bh} width={bw} height={Math.max(bh, h[s] > 0 ? 2 : 0)} rx={3} className="fill-star" />
              <text x={x + bw / 2} y={H + 16} textAnchor="middle" className="fill-text-muted text-[12px]">{s}★</text>
            </g>
          );
        })}
        <line x1={0} x2={W} y1={H} y2={H} className="stroke-border-strong" strokeWidth={1} />
      </svg>
    </figure>
  );
}

export function VerifiedVsAllChart({ avg, count, verifiedAvg, verifiedCount }: { avg: number | null; count: number; verifiedAvg: number | null; verifiedCount: number }) {
  const rows = [
    { key: "all", label: t("charts.all"), avg, count, cls: "bg-primary" },
    { key: "verified", label: t("charts.verified"), avg: verifiedAvg, count: verifiedCount, cls: "bg-verified" },
  ];
  return (
    <figure data-testid="chart-verified" className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <figcaption className="font-semibold">{t("charts.verifiedVsAll")}</figcaption>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.key}>
            {r.avg !== null && r.count > 0 ? (
              <>
                <p className="flex justify-between text-sm"><span>{r.label}</span><span className="tabular-nums">{t("charts.avgValue", { avg: r.avg.toFixed(1), count: r.count })}</span></p>
                <div role="img" aria-label={t("charts.avgRow", { label: r.label, avg: r.avg.toFixed(1), count: r.count })} className="mt-1 h-3 overflow-hidden rounded-full border border-border bg-bg-subtle">
                  <div className={`h-full rounded-full ${r.cls}`} style={{ width: `${Math.min(100, (r.avg / 5) * 100)}%` }} />
                </div>
              </>
            ) : <p className="text-sm text-text-muted">{r.key === "verified" ? t("charts.noVerified") : t("products.noRatings")}</p>}
          </li>
        ))}
      </ul>
    </figure>
  );
}

export default function ProductCharts(props: { histogram: unknown; count: number; avg: number | null; verifiedAvg: number | null; verifiedCount: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="product-charts">
      <RatingDistributionChart histogram={props.histogram} count={props.count} />
      <VerifiedVsAllChart avg={props.avg} count={props.count} verifiedAvg={props.verifiedAvg} verifiedCount={props.verifiedCount} />
    </div>
  );
}
