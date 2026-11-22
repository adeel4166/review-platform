import Link from "next/link";
import { db } from "@/server/db";
import { listProducts } from "@/server/products";
import { productListQuery } from "@/server/validation";
import { t } from "@/i18n/en";
import { ProductCard } from "./ui/ProductCard";
import { ProductCardSkeleton, SkeletonRegion } from "./ui/Skeleton";

export function HomeProductsFallback() {
  return <SkeletonRegion className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <ProductCardSkeleton key={i} />)}</SkeletonRegion>;
}

/** Section hides itself when there is nothing to show or the query fails (the hero never depends on it). */
export async function HomeProducts() {
  let items: Awaited<ReturnType<typeof listProducts>>["items"] = [];
  try { items = (await listProducts(db, productListQuery.parse({ pageSize: 4 }))).items; } catch { return null; }
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="home-top" className="mx-auto max-w-content px-4 py-10 md:px-6 lg:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="home-top" className="text-xl font-semibold md:text-2xl">{t("home.top.title")}</h2>
        <Link href="/products" className="inline-flex min-h-target items-center text-link underline">{t("home.top.all")}</Link>
      </div>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((p) => <li key={p.id}><ProductCard product={p} /></li>)}
      </ul>
    </section>
  );
}
