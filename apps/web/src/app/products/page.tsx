import Link from "next/link";
import { db } from "@/server/db";
import { listProducts } from "@/server/products";
import { productListQuery } from "@/server/validation";
import { Pagination } from "@/components/Pagination";
import { Stars } from "@/components/Stars";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("products.title")} · ${t("app.name")}` };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ProductsPage({ searchParams }: { searchParams: SP }) {
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = productListQuery.safeParse({ ...raw, pageSize: 12 });
  const q = parsed.success ? parsed.data : productListQuery.parse({ pageSize: 12 });
  const { items, total, page, pageSize } = await listProducts(db, q);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => `/products?${new URLSearchParams({ ...(q.q ? { q: q.q } : {}), page: String(p) })}`;
  return (
    <main className="mx-auto max-w-content px-4 py-6">
      <h1 className="text-2xl font-semibold">{t("products.title")}</h1>
      <form role="search" action="/products" className="mt-4 flex flex-wrap gap-2">
        <label htmlFor="q" className="sr-only">{t("products.search.label")}</label>
        <input id="q" name="q" type="search" defaultValue={q.q ?? ""} maxLength={100} placeholder={t("products.search.label")}
          className="min-h-target min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3" />
        <button type="submit" className="min-h-target rounded-md bg-primary px-4 text-on-primary hover:bg-primary-hover">{t("products.search.submit")}</button>
      </form>
      <p className="mt-3 text-text-muted" role="status">{t("products.count", { total })}</p>
      {items.length === 0 ? (
        <p className="mt-6">{t("products.empty")}</p>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <li key={p.id} className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-lg font-semibold">
                <Link href={`/products/${p.slug}`} className="text-link underline">{p.name}</Link>
              </h2>
              <p className="text-sm text-text-muted">{p.brandName} · {p.category.name}</p>
              <p className="mt-2 flex items-center gap-2 text-sm">
                {p.ratingCount > 0 ? (<><Stars value={Number(p.ratingAverage)} /><span aria-hidden="true">{Number(p.ratingAverage).toFixed(1)}</span> <span className="text-text-muted">{t("products.reviews", { count: p.reviewCount })}</span></>) : <span className="text-text-muted">{t("products.noRatings")}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pages={pages} href={href} />
    </main>
  );
}
