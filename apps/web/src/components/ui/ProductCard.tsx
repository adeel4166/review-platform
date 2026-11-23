import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/i18n/en";
import { Stars } from "../Stars";
import { HoverLift } from "./Reveal";
import { SafeImage } from "./SafeImage";

export interface ProductImageData { url: string; width: number; height: number; alt: string }
export interface ProductCardData {
  id: string; slug: string; name: string; brandName: string | null;
  category: { name: string };
  ratingAverage: unknown; ratingCount: number; reviewCount: number;
  verifiedRatingAverage?: unknown; verifiedRatingCount?: number;
  primaryImage?: ProductImageData | null;
}

/** Fixed-aspect box, so no layout shift. Letter fallback only when there is no published image. */
export function ProductThumb({ name, image, priority = false, sizes = "(min-width:1024px) 25vw, (min-width:640px) 50vw, 100vw", className = "", transitionName }: {
  name: string; image?: ProductImageData | null; priority?: boolean; sizes?: string; className?: string; transitionName?: string;
}) {
  const style = transitionName ? { viewTransitionName: transitionName } : undefined;
  const letter = (
    <div aria-hidden="true" style={image ? undefined : style} className={image ? "absolute inset-0 flex items-center justify-center border border-dashed border-border bg-bg-subtle text-3xl font-semibold text-text-muted" : `flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-border bg-bg-subtle text-3xl font-semibold text-text-muted ${className}`}>
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </div>
  );
  if (image) {
    return (
      <div className={`relative aspect-square w-full overflow-hidden rounded-md bg-bg-subtle ring-1 ring-inset ring-border ${className}`} style={style}>
        <SafeImage src={image.url} alt={image.alt || name} fill sizes={sizes} priority={priority} unoptimized={image.url.endsWith(".svg")} className="object-contain" fallback={letter} />
      </div>
    );
  }
  return letter;
}

/** Whole card is one link target (stretched link on the name); `extra` (e.g. compare checkbox) sits above it. */
export function ProductCard({ product: p, extra, priority = false, rank }: { product: ProductCardData; extra?: ReactNode; priority?: boolean; rank?: number }) {
  const avg = Number(p.ratingAverage);
  const vAvg = Number(p.verifiedRatingAverage);
  const showVerified = (p.verifiedRatingCount ?? 0) > 0 && Number.isFinite(vAvg);
  return (
    <HoverLift className="h-full">
      <div className="relative flex h-full flex-col rounded-lg border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md focus-within:shadow-md" data-testid="product-card">
        {rank !== undefined && <span className="absolute start-6 top-6 z-10 rounded-full bg-surface px-2 py-0.5 text-xs font-semibold tabular-nums shadow-sm ring-1 ring-border"><span className="sr-only">{t("home.trending.rank")} </span>#{rank}</span>}
        <ProductThumb name={p.name} image={p.primaryImage} priority={priority} transitionName={`product-img-${p.id}`} />
        {p.brandName && <p className="mt-3 text-xs text-text-muted">{p.brandName}</p>}
        <h3 className={`${p.brandName ? "mt-0.5" : "mt-3"} line-clamp-2 text-lg font-semibold leading-tight`} title={p.name}>
          <Link href={`/products/${p.slug}`} className="text-text after:absolute after:inset-0 after:content-[''] hover:underline">{p.name}</Link>
        </h3>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm">
          {p.ratingCount > 0 ? (<><Stars value={avg} /><span aria-hidden="true" className="tabular-nums">{avg.toFixed(1)}</span><span className="text-text-muted">{t("products.reviews", { count: p.reviewCount })}</span></>) : <span className="text-text-muted">{t("products.noRatings")}</span>}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-full bg-bg-subtle px-2 py-0.5 text-xs font-medium">{p.category.name}</span>
          {showVerified && <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success" data-testid="verified-rating"><span aria-hidden="true">✓</span>{t("product.verifiedRating.short", { rating: vAvg.toFixed(1) })}</span>}
        </p>
        {extra && <div className="relative z-10 mt-auto pt-2">{extra}</div>}
      </div>
    </HoverLift>
  );
}
