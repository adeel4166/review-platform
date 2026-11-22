import Link from "next/link";
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { db } from "@/server/db";
import { getImageResolver } from "@/server/storage";
import { t, type MessageKey } from "@/i18n/en";
import { compare } from "@/server/compare";
import { Stars } from "@/components/Stars";
import { TrustBand } from "@/components/TrustBand";
import { ProductThumb, type ProductImageData } from "@/components/ui/ProductCard";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("compare.h1")} · ${t("app.name")}` };

type Item = { id: string; unavailable?: true; slug?: string; name?: string; primaryImage?: ProductImageData | null; ratingAverage?: number | null; ratingCount?: number; verifiedRatingAverage?: number | null; verifiedRatingCount?: number; verifiedShare?: number; lowSample?: boolean; histogramPct?: Record<string, number>; specs?: Record<string, unknown>; sellerBand?: string | null; best?: string[]; mergedFrom?: string };
type Row = { key: string; label: string; strong?: boolean; render: (i: Item) => ReactNode; best?: Set<string> };

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? t("compare.none") : v.toFixed(1));
/** Ids holding the highest value (ties all win); nothing is "best" unless at least two products have a value to compare. */
function topIds(items: Item[], pick: (i: Item) => number | null | undefined): Set<string> {
  const vals = items.filter((i) => !i.unavailable).map((i) => [i.id, pick(i)] as const).filter((e): e is readonly [string, number] => typeof e[1] === "number");
  if (vals.length < 2) return new Set();
  const max = Math.max(...vals.map((e) => e[1]));
  return new Set(vals.filter((e) => e[1] === max).map((e) => e[0]));
}
const BestMark = () => <span data-testid="best" className="ml-2 inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-xs font-semibold text-success"><Check size={12} strokeWidth={2} aria-hidden="true" />{t("compare.best")}</span>;
const Cell = ({ i, best, children }: { i: Item; best?: Set<string>; children: ReactNode }) => i.unavailable ? <>—</> : (
  <span className={best?.has(i.id) ? "rounded-md bg-success-bg/60 px-1.5 py-0.5" : undefined}>{children}{best?.has(i.id) && <BestMark />}</span>
);

/** 05 comparison (V3-02): 2-4 products from cached aggregates. Desktop = table with sticky image headers; mobile = swipeable snap cards. "Best" is text + icon, never colour alone. */
export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const raw = (await searchParams).ids;
  const ids = (Array.isArray(raw) ? raw.join(",") : raw ?? "");
  let data: { items: Item[]; categoriesDiffer: boolean } | null = null, errorKey: MessageKey | null = null;
  try { data = (await compare(db, ids, undefined, getImageResolver())) as { items: Item[]; categoriesDiffer: boolean }; }
  catch (e) { const c = (e as { code?: string }).code; errorKey = c === "compare_duplicate" ? "compare.err.duplicate" : "compare.err.size"; }
  const items = data?.items ?? [];
  const specKeys = [...new Set(items.flatMap((i) => Object.keys(i.specs ?? {})))];
  const bestRating = topIds(items.filter((i) => !i.lowSample), (i) => i.ratingAverage);
  const bestVerified = topIds(items, (i) => i.verifiedRatingAverage);
  const rows: Row[] = [
    { key: "rating", label: t("compare.rating"), strong: true, best: bestRating, render: (i) => (
      <Cell i={i} best={bestRating}><Stars value={Number(i.ratingAverage ?? 0)} /> {fmt(i.ratingAverage)} <span className="text-text-muted">({t("products.reviews", { count: i.ratingCount ?? 0 })})</span>{i.lowSample && <span className="block text-sm" data-testid="low-sample">{t("compare.lowSample")}</span>}</Cell>) },
    { key: "verified", label: t("compare.verified"), strong: true, best: bestVerified, render: (i) => <Cell i={i} best={bestVerified}>{`${fmt(i.verifiedRatingAverage)} · ${t("compare.verifiedShare", { pct: i.verifiedShare ?? 0 })}`}</Cell> },
    ...[5, 4, 3, 2, 1].map((s): Row => ({ key: `star${s}`, label: t("compare.star", { n: s }), render: (i) => (i.unavailable ? "—" : `${i.histogramPct?.[String(s)] ?? 0}%`) })),
    { key: "seller", label: t("compare.seller"), render: (i) => (!i.sellerBand ? "—" : <TrustBand band={i.sellerBand} />) },
    ...specKeys.map((k): Row => ({ key: `spec:${k}`, label: k.replace(/_/g, " "), render: (i) => i.unavailable ? "—" : <>{String(i.specs?.[k] ?? t("compare.none"))}{i.best?.includes(k) && <strong data-testid="best"> · {t("compare.best")}</strong>}</> })),
  ];
  const nameOf = (i: Item) => i.unavailable ? t("compare.unavailable") : <Link className="text-link underline" href={`/products/${i.slug}`}>{i.name}</Link>;
  return (
    <main className="mx-auto max-w-content px-4 py-6 md:px-6 md:py-8 lg:px-8">
      <h1 className="text-2xl font-bold leading-tight md:text-3xl">{t("compare.h1")}</h1>
      {errorKey ? <p role="alert" className="mt-3">{t(errorKey)} <Link className="text-link underline" href="/products">{t("nav.products")}</Link></p> : (
        <>
          {data?.categoriesDiffer && <p role="note" className="mt-3">{t("compare.differ")}</p>}
          {/* Desktop / tablet: real table; header row sticks under the site header while the page scrolls. */}
          <div className="mt-4 hidden rounded-lg border border-border bg-surface shadow-sm md:block">
            <table className="w-full text-left">
              <caption className="sr-only">{t("compare.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky top-[3.75rem] z-10 rounded-tl-lg bg-surface p-3"><span className="sr-only">{t("compare.caption")}</span></th>
                  {items.map((i) => (
                    <th key={i.id} scope="col" className="sticky top-[3.75rem] z-10 w-1/4 border-b border-border bg-surface p-3 align-top font-semibold">
                      {!i.unavailable && <div className="mb-2 w-24"><ProductThumb name={i.name ?? ""} image={i.primaryImage} sizes="96px" /></div>}
                      {nameOf(i)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-border">
                    <th scope="row" className={`p-3 ${r.strong ? "font-medium" : "font-normal"}`}>{r.label}</th>
                    {items.map((i) => <td key={i.id} className="p-3">{i.unavailable ? "—" : r.render(i)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile: one card per product, swipe sideways (scroll-snap); focusable so keyboard users can scroll it too. */}
          <p className="mt-3 text-sm text-text-muted md:hidden">{t("compare.swipeHint")}</p>
          <div role="region" aria-label={t("compare.h1")} tabIndex={0} data-testid="compare-swipe" className="-mx-4 mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 md:hidden">
            {items.map((i) => (
              <section key={i.id} aria-label={i.unavailable ? t("compare.unavailable") : i.name} className="w-[82%] max-w-sm shrink-0 snap-center rounded-lg border border-border bg-surface p-4 shadow-sm">
                {!i.unavailable && <div className="mx-auto mb-3 w-32"><ProductThumb name={i.name ?? ""} image={i.primaryImage} sizes="128px" /></div>}
                <h2 className="font-semibold">{nameOf(i)}</h2>
                <dl className="mt-3 divide-y divide-border">
                  {rows.map((r) => <div key={r.key} className="py-2"><dt className="text-sm text-text-muted">{r.label}</dt><dd>{i.unavailable ? "—" : r.render(i)}</dd></div>)}
                </dl>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
