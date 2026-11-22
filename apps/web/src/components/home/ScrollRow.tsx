"use client";

import { useRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { t } from "@/i18n/en";

/** Keyboard-focusable scroll-snap row with Prev/Next buttons (≥md, hidden at lg where the row becomes a grid). No autoplay. */
export function ScrollRow({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  const by = (dir: 1 | -1) => {
    const el = ref.current; if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    el.scrollBy({ left: dir * (rtl ? -1 : 1) * el.clientWidth * 0.8, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const btn = "hidden h-11 w-11 items-center justify-center rounded-full border border-border-strong bg-surface text-text hover:bg-bg-subtle md:inline-flex lg:hidden";
  return (
    <div>
      <div className="mb-2 flex justify-end gap-2">
        <button type="button" onClick={() => by(-1)} aria-label={t("product.gallery.prev")} className={btn}><ChevronLeft aria-hidden="true" className="h-5 w-5 rtl:-scale-x-100" /></button>
        <button type="button" onClick={() => by(1)} aria-label={t("product.gallery.next")} className={btn}><ChevronRight aria-hidden="true" className="h-5 w-5 rtl:-scale-x-100" /></button>
      </div>
      <ul ref={ref} role="region" aria-label={label} tabIndex={0} className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible">
        {children}
      </ul>
    </div>
  );
}
