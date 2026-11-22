import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/i18n/en";
import { Stars } from "../Stars";

export interface ProductCardData {
  id: string; slug: string; name: string; brandName: string | null;
  category: { name: string };
  ratingAverage: unknown; ratingCount: number; reviewCount: number;
}

/** Fixed-aspect media box (no layout shift); there is no product image in the data model yet, so a category glyph placeholder is shown. */
export function ProductThumb({ name, className = "" }: { name: string; className?: string }) {
  return (
    <div aria-hidden="true" className={`flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-border bg-bg-subtle text-3xl font-semibold text-text-muted ${className}`}>
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </div>
  );
}

/** Whole card is one link target (stretched link on the name); `extra` (e.g. compare checkbox) sits above it. */
export function ProductCard({ product: p, extra }: { product: ProductCardData; extra?: ReactNode }) {
  const avg = Number(p.ratingAverage);
  return (
    <div className="relative flex h-full flex-col rounded-lg border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md focus-within:shadow-md" data-testid="product-card">
      <ProductThumb name={p.name} />
      {p.brandName && <p className="mt-3 text-xs text-text-muted">{p.brandName}</p>}
      <h3 className={`${p.brandName ? "mt-0.5" : "mt-3"} line-clamp-2 text-lg font-semibold leading-tight`} title={p.name}>
        <Link href={`/products/${p.slug}`} className="text-text after:absolute after:inset-0 after:content-[''] hover:underline">{p.name}</Link>
      </h3>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm">
        {p.ratingCount > 0 ? (<><Stars value={avg} /><span aria-hidden="true" className="tabular-nums">{avg.toFixed(1)}</span><span className="text-text-muted">{t("products.reviews", { count: p.reviewCount })}</span></>) : <span className="text-text-muted">{t("products.noRatings")}</span>}
      </p>
      <p className="mt-2"><span className="inline-flex rounded-full bg-bg-subtle px-2 py-0.5 text-xs font-medium">{p.category.name}</span></p>
      {extra && <div className="relative z-10 mt-auto pt-2">{extra}</div>}
    </div>
  );
}
