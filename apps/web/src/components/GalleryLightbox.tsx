"use client";

import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { t } from "@/i18n/en";
import { DialogRoot, DialogTitle, DialogDescription } from "./ui/primitives/dialog";
import { Dialog as D } from "radix-ui";
import { SafeImage } from "./ui/SafeImage";
import type { ProductImageData } from "./ui/ProductCard";

const nav = "inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-strong bg-surface text-text shadow-sm hover:bg-bg-subtle";
const alt = (img: ProductImageData, name: string, n: number) => img.alt || t("product.imageAlt", { name, n });

/** Full-screen lightbox; code-split from the gallery (ADR-0034 D10) and only fetched when the user opens it. */
export default function GalleryLightbox({ name, img, i, total, zoom, setZoom, go, onClose }: {
  name: string; img: ProductImageData; i: number; total: number; zoom: number;
  setZoom: (f: (z: number) => number) => void; go: (d: number) => void; onClose: () => void;
}) {
  const cur = img;
  return (
    <DialogRoot open onOpenChange={(o) => { if (!o) onClose(); }}>
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
            <SafeImage fallback={<div aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-bg-subtle text-3xl font-semibold text-text-muted">{name.trim().slice(0, 1).toUpperCase() || "?"}</div>} src={cur.url} alt={alt(cur, name, i + 1)} fill sizes="100vw" unoptimized={cur.url.endsWith(".svg")} className="object-contain" />
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
  );
}
