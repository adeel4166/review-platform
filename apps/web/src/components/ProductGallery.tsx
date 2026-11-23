"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { SafeImage } from "./ui/SafeImage";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { t } from "@/i18n/en";
import { ProductThumb, type ProductImageData } from "./ui/ProductCard";

const GalleryLightbox = dynamic(() => import("./GalleryLightbox"), { ssr: false });

const nav = "inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-strong bg-surface text-text shadow-sm hover:bg-bg-subtle";
const alt = (img: ProductImageData, name: string, n: number) => img.alt || t("product.imageAlt", { name, n });

/** Gallery: main stage (first image `priority`, fixed aspect → no CLS), thumbs, prev/next, counter, and a full-screen lightbox. No autoplay. */
export function ProductGallery({ name, images, transitionName }: { name: string; images: ProductImageData[]; transitionName?: string }) {
  const [i, setI] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const total = images.length;
  if (total === 0) {
    return (
      <div role="region" aria-roledescription="gallery" aria-label={t("product.gallery.label", { name })}>
        <ProductThumb name={name} transitionName={transitionName} className="max-w-[14rem] md:max-w-none" />
        <p className="mt-2 text-sm text-text-muted">{t("product.noImage")}</p>
      </div>
    );
  }
  const go = (d: number) => { setI((x) => (x + d + total) % total); setZoom(1); };
  const cur = images[i]!;
  return (
    <div role="region" aria-roledescription="gallery" aria-label={t("product.gallery.label", { name })}>
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-bg-subtle ring-1 ring-inset ring-border md:aspect-[4/3]" style={transitionName ? { viewTransitionName: transitionName } : undefined}>
        <SafeImage fallback={<div aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-bg-subtle text-3xl font-semibold text-text-muted">{name.trim().slice(0, 1).toUpperCase() || "?"}</div>} key={cur.url} src={cur.url} alt={alt(cur, name, i + 1)} fill priority={i === 0} sizes="(min-width:1024px) 58vw, 100vw" unoptimized={cur.url.endsWith(".svg")} className="object-contain motion-safe:animate-in motion-safe:fade-in" />
        <span className="absolute bottom-2 start-2 rounded-full bg-surface px-3 py-1 text-sm tabular-nums shadow-sm ring-1 ring-border" aria-live="polite">{t("product.gallery.counter", { n: i + 1, total })}</span>
        <button type="button" ref={trigger} className={`${nav} absolute end-2 top-2`} aria-haspopup="dialog" aria-label={t("product.gallery.open", { n: i + 1 })} onClick={() => setOpen(true)}><Maximize2 aria-hidden="true" className="h-5 w-5" /></button>
        {open && <GalleryLightbox name={name} img={cur} i={i} total={total} zoom={zoom} setZoom={setZoom} go={go} onClose={() => { setOpen(false); setZoom(1); trigger.current?.focus(); }} />}
        {total > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label={t("product.gallery.prev")} className={`${nav} absolute start-2 top-1/2 -translate-y-1/2`}><ChevronLeft aria-hidden="true" className="h-5 w-5 rtl:-scale-x-100" /></button>
            <button type="button" onClick={() => go(1)} aria-label={t("product.gallery.next")} className={`${nav} absolute end-2 top-1/2 -translate-y-1/2`}><ChevronRight aria-hidden="true" className="h-5 w-5 rtl:-scale-x-100" /></button>
          </>
        )}
      </div>
      {total > 1 && (
        <ul className="mt-3 flex snap-x gap-2 overflow-x-auto pb-1">
          {images.map((img, n) => (
            <li key={img.url} className="shrink-0 snap-start">
              <button type="button" onClick={() => { setI(n); setZoom(1); }} aria-current={n === i ? "true" : undefined} aria-label={t("product.gallery.show", { n: n + 1, total, alt: alt(img, name, n + 1) })}
                className={`relative block h-16 w-16 overflow-hidden rounded-lg bg-bg-subtle ${n === i ? "border-2 border-primary" : "border border-border"}`}>
                <SafeImage fallback={<div aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-bg-subtle text-3xl font-semibold text-text-muted">{name.trim().slice(0, 1).toUpperCase() || "?"}</div>} src={img.url} alt="" fill sizes="64px" unoptimized={img.url.endsWith(".svg")} className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
