"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus } from "lucide-react";
import { t } from "@/i18n/en";
import { DialogRoot, DialogTrigger, DialogTitle, DialogDescription } from "./ui/primitives/dialog";
import { Dialog as D } from "radix-ui";
import { ProductThumb, type ProductImageData } from "./ui/ProductCard";

const nav = "inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-strong bg-surface text-text shadow-sm hover:bg-bg-subtle";
const alt = (img: ProductImageData, name: string, n: number) => img.alt || t("product.imageAlt", { name, n });

/** Gallery: main stage (first image `priority`, fixed aspect → no CLS), thumbs, prev/next, counter, and a full-screen lightbox. No autoplay. */
export function ProductGallery({ name, images, transitionName }: { name: string; images: ProductImageData[]; transitionName?: string }) {
  const [i, setI] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [open, setOpen] = useState(false);
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
        <Image key={cur.url} src={cur.url} alt={alt(cur, name, i + 1)} fill priority={i === 0} sizes="(min-width:1024px) 58vw, 100vw" unoptimized={cur.url.endsWith(".svg")} className="object-contain motion-safe:animate-in motion-safe:fade-in" />
        <span className="absolute bottom-2 start-2 rounded-full bg-surface px-3 py-1 text-sm tabular-nums shadow-sm ring-1 ring-border" aria-live="polite">{t("product.gallery.counter", { n: i + 1, total })}</span>
        <DialogRoot open={open} onOpenChange={(o) => { setOpen(o); setZoom(1); }}>
          <DialogTrigger className={`${nav} absolute end-2 top-2`} aria-label={t("product.gallery.open", { n: i + 1 })}><Maximize2 aria-hidden="true" className="h-5 w-5" /></DialogTrigger>
          <D.Portal>
            <D.Overlay className="fixed inset-0 z-50 bg-black/80" />
            <D.Content onKeyDown={(e) => { if (e.key === "ArrowLeft") go(document.dir === "rtl" ? 1 : -1); if (e.key === "ArrowRight") go(document.dir === "rtl" ? -1 : 1); }} className="fixed inset-0 z-50 flex flex-col p-4 outline-hidden">
              <DialogTitle className="sr-only">{t("product.gallery.lightbox", { name })}</DialogTitle>
              <DialogDescription className="sr-only">{alt(cur, name, i + 1)}</DialogDescription>
              <div className="flex items-center justify-between gap-2 text-white">
                <span className="tabular-nums">{t("product.gallery.counter", { n: i + 1, total })}</span>
                <div className="flex gap-2">
                  <button type="button" className={nav} onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label={t("product.gallery.zoomOut")}><Minus aria-hidden="true" className="h-5 w-5" /></button>
                  <button type="button" className={nav} onClick={() => setZoom((z) => Math.min(3, z + 0.5))} aria-label={t("product.gallery.zoomIn")}><Plus aria-hidden="true" className="h-5 w-5" /></button>
                  <D.Close className="inline-flex h-11 items-center rounded-full border border-border-strong bg-surface px-4 font-medium text-text">{t("product.gallery.close")}</D.Close>
                </div>
              </div>
              <div className="relative mt-3 flex-1 overflow-auto">
                <div className="relative h-full min-h-[50vh] transition-transform motion-reduce:transition-none" style={{ transform: `scale(${zoom})` }}>
                  <Image src={cur.url} alt={alt(cur, name, i + 1)} fill sizes="100vw" unoptimized={cur.url.endsWith(".svg")} className="object-contain" />
                </div>
              </div>
              {total > 1 && (
                <div className="mt-3 flex justify-center gap-3">
                  <button type="button" className={nav} onClick={() => go(-1)} aria-label={t("product.gallery.prev")}><ChevronLeft aria-hidden="true" className="h-5 w-5 rtl:-scale-x-100" /></button>
                  <button type="button" className={nav} onClick={() => go(1)} aria-label={t("product.gallery.next")}><ChevronRight aria-hidden="true" className="h-5 w-5 rtl:-scale-x-100" /></button>
                </div>
              )}
            </D.Content>
          </D.Portal>
        </DialogRoot>
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
                <Image src={img.url} alt="" fill sizes="64px" unoptimized={img.url.endsWith(".svg")} className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
