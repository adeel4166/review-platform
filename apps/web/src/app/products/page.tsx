import Link from "next/link";
import { db } from "@/server/db";
import { getImageResolver } from "@/server/storage";
import { listProducts } from "@/server/products";
import { productListQuery } from "@/server/validation";
import { Pagination } from "@/components/Pagination";
import { ProductCard } from "@/components/ui/ProductCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("products.title")} · ${t("app.name")}` };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ProductsPage({ searchParams }: { searchParams: SP }) {
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = productListQuery.safeParse({ ...raw, pageSize: 12 });
  const q = parsed.success ? parsed.data : productListQuery.parse({ pageSize: 12 });
  const { items, total, page, pageSize } = await listProducts(db, q, getImageResolver());
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => `/products?${new URLSearchParams({ ...(q.q ? { q: q.q } : {}), page: String(p) })}`;
  return (
    <main className="mx-auto max-w-content px-4 py-6 md:px-6 lg:px-8">
      <h1 className="text-2xl font-bold md:text-3xl">{t("products.title")}</h1>
      <form role="search" action="/products" className="mt-4 flex max-w-2xl flex-wrap gap-2">
        <label htmlFor="q" className="sr-only">{t("products.search.label")}</label>
        <input id="q" name="q" type="search" defaultValue={q.q ?? ""} maxLength={100} placeholder={t("products.search.label")}
          className="min-h-target min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3" />
        <button type="submit" className="min-h-target rounded-md bg-primary px-4 font-semibold text-on-primary hover:bg-primary-hover">{t("products.search.submit")}</button>
      </form>
      <p className="mt-3 text-text-muted" role="status">{t("products.count", { total })}</p>
      {items.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={t("products.empty")} description={t("products.emptyHint")}
            action={q.q ? <Link href="/products" className="inline-flex min-h-target items-center rounded-md bg-primary px-4 font-semibold text-on-primary">{t("products.filter.clear")}</Link> : undefined} />
        </div>
      ) : (
        <form action="/compare" method="get" className="mt-4">
          <h2 className="sr-only">{t("products.results")}</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} extra={<label className="inline-flex min-h-target items-center gap-2 text-sm"><input type="checkbox" name="ids" value={p.id} className="h-5 w-5" />{t("compare.add")}<span className="sr-only">: {p.name}</span></label>} />
              </li>
            ))}
          </ul>
          <button type="submit" className="mt-4 min-h-target rounded-md border border-border-strong bg-surface px-4 font-medium">{t("compare.go")}</button>
          <p className="text-sm text-text-muted">{t("compare.hint")}</p>
        </form>
      )}
      <Pagination page={page} pages={pages} href={href} />
    </main>
  );
}
