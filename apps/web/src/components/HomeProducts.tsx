import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { db } from "@/server/db";
import { getImageResolver } from "@/server/storage";
import { listProducts } from "@/server/products";
import { productListQuery } from "@/server/validation";
import { t } from "@/i18n/en";
import { ProductCard } from "./ui/ProductCard";
import { EmptyState } from "./ui/EmptyState";
import { Reveal } from "./ui/Reveal";
import { ProductCardSkeleton, SkeletonRegion } from "./ui/Skeleton";
import { ScrollRow } from "./home/ScrollRow";

export function HomeProductsFallback() {
  return <SkeletonRegion className="mx-auto mt-4 grid max-w-content gap-4 px-4 sm:grid-cols-2 md:px-6 lg:grid-cols-4 lg:px-8">{[0, 1, 2, 3].map((i) => <ProductCardSkeleton key={i} />)}</SkeletonRegion>;
}

/** Trending = the best-reviewed active products (the listing orders by recency; we re-rank the first page by review volume). A query failure shows the empty state, never a broken hero. */
export async function HomeProducts() {
  let items: Awaited<ReturnType<typeof listProducts>>["items"] = [];
  try { items = (await listProducts(db, productListQuery.parse({ pageSize: 12 }), getImageResolver())).items; } catch { items = []; }
  items = [...items].sort((a, b) => b.reviewCount - a.reviewCount).slice(0, 4);
  return (
    <section aria-labelledby="home-top" className="mx-auto max-w-content px-4 py-10 md:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="home-top" className="text-xl font-semibold md:text-2xl">{t("home.trending.title")}</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-subtle px-2 py-0.5 text-xs font-semibold text-on-accent-subtle"><TrendingUp aria-hidden="true" className="h-3.5 w-3.5" />{t("home.trending.badge")}</span>
        </div>
        <Link href="/products" className="inline-flex min-h-target items-center text-link underline">{t("home.top.all")}</Link>
      </div>
      {items.length === 0 ? (
        <div className="mt-4"><EmptyState title={t("home.trending.empty")} action={<Link href="/products" className="inline-flex min-h-target items-center rounded-md bg-primary px-4 font-semibold text-on-primary">{t("home.trending.browse")}</Link>} /></div>
      ) : (
        <div className="mt-2">
          <ScrollRow label={t("home.trending.region")}>
            {items.map((p, i) => (
              <Reveal as="li" key={p.id} delay={i * 0.05} className="w-64 shrink-0 snap-start sm:w-72 lg:w-auto"><ProductCard product={p} rank={i + 1} /></Reveal>
            ))}
          </ScrollRow>
        </div>
      )}
    </section>
  );
}
