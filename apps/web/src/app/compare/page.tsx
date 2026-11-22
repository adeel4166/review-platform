import Link from "next/link";
import { db } from "@/server/db";
import { t, type MessageKey } from "@/i18n/en";
import { compare } from "@/server/compare";
import { Stars } from "@/components/Stars";
import { TrustBand } from "@/components/TrustBand";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("compare.h1")} · ${t("app.name")}` };

type Item = { id: string; unavailable?: true; slug?: string; name?: string; ratingAverage?: number | null; ratingCount?: number; verifiedRatingAverage?: number | null; verifiedRatingCount?: number; verifiedShare?: number; lowSample?: boolean; histogramPct?: Record<string, number>; specs?: Record<string, unknown>; sellerBand?: string | null; best?: string[]; mergedFrom?: string };

/** 05 comparison: 2-4 products from cached aggregates. Table with row/column headers; "best" is text, not colour; low sample flagged; unavailable columns say so. */
export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const raw = (await searchParams).ids;
  const ids = (Array.isArray(raw) ? raw.join(",") : raw ?? "");
  let data: { items: Item[]; categoriesDiffer: boolean } | null = null, errorKey: MessageKey | null = null;
  try { data = (await compare(db, ids)) as { items: Item[]; categoriesDiffer: boolean }; }
  catch (e) { const c = (e as { code?: string }).code; errorKey = c === "compare_duplicate" ? "compare.err.duplicate" : "compare.err.size"; }
  const items = data?.items ?? [];
  const specKeys = [...new Set(items.flatMap((i) => Object.keys(i.specs ?? {})))];
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? t("compare.none") : v.toFixed(1));
  return (
    <main className="mx-auto max-w-content px-4 py-6 md:px-6 md:py-8 lg:px-8">
      <h1 className="text-2xl font-bold leading-tight md:text-3xl">{t("compare.h1")}</h1>
      {errorKey ? <p role="alert" className="mt-3">{t(errorKey)} <Link className="text-link underline" href="/products">{t("nav.products")}</Link></p> : (
        <>
          {data?.categoriesDiffer && <p role="note" className="mt-3">{t("compare.differ")}</p>}
          <div role="region" aria-label={t("compare.h1")} tabIndex={0} className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
            <table className="w-full min-w-[32rem] text-left">
              <caption className="sr-only">{t("compare.caption")}</caption>
              <thead><tr><td className="p-2" />{items.map((i) => <th key={i.id} scope="col" className="p-2 align-top">{i.unavailable ? t("compare.unavailable") : <Link className="text-link underline" href={`/products/${i.slug}`}>{i.name}</Link>}</th>)}</tr></thead>
              <tbody>
                <tr className="border-t border-border"><th scope="row" className="p-2 font-medium">{t("compare.rating")}</th>{items.map((i) => <td key={i.id} className="p-2">{i.unavailable ? "—" : <><Stars value={Number(i.ratingAverage ?? 0)} /> {fmt(i.ratingAverage)} <span className="text-text-muted">({t("products.reviews", { count: i.ratingCount ?? 0 })})</span>{i.lowSample && <span className="block text-sm" data-testid="low-sample">{t("compare.lowSample")}</span>}</>}</td>)}</tr>
                <tr className="border-t border-border"><th scope="row" className="p-2 font-medium">{t("compare.verified")}</th>{items.map((i) => <td key={i.id} className="p-2">{i.unavailable ? "—" : `${fmt(i.verifiedRatingAverage)} · ${t("compare.verifiedShare", { pct: i.verifiedShare ?? 0 })}`}</td>)}</tr>
                {[5, 4, 3, 2, 1].map((s) => <tr key={s} className="border-t border-border"><th scope="row" className="p-2 font-normal">{t("compare.star", { n: s })}</th>{items.map((i) => <td key={i.id} className="p-2">{i.unavailable ? "—" : `${i.histogramPct?.[String(s)] ?? 0}%`}</td>)}</tr>)}
                <tr className="border-t border-border"><th scope="row" className="p-2 font-medium">{t("compare.seller")}</th>{items.map((i) => <td key={i.id} className="p-2">{!i.sellerBand ? "—" : <TrustBand band={i.sellerBand} />}</td>)}</tr>
                {specKeys.map((k) => <tr key={k} className="border-t border-border"><th scope="row" className="p-2 font-medium">{k.replace(/_/g, " ")}</th>{items.map((i) => <td key={i.id} className="p-2">{i.unavailable ? "—" : String(i.specs?.[k] ?? t("compare.none"))}{i.best?.includes(k) && <strong data-testid="best"> · {t("compare.best")}</strong>}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
