"use client";

import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog (WAI-ARIA APG): role=dialog + aria-modal, labelled, focus moves in, Tab is trapped, Esc closes,
 * focus returns to the previously focused element (WCAG 2.4.3, 4.1.2).
 */
export function Dialog({ titleId, title, onClose, children, wide = false }: { titleId: string; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const root = ref.current;
    (root?.querySelector<HTMLElement>("[data-autofocus]") ?? root?.querySelector<HTMLElement>(FOCUSABLE) ?? root)?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !root) return;
      const els = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (els.length === 0) { e.preventDefault(); return; }
      const first = els[0]!, last = els[els.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`max-h-full w-full ${wide ? "max-w-3xl" : "max-w-lg"} overflow-y-auto rounded-lg border border-border bg-surface p-5 text-text shadow-lg`}>
        <h2 id={titleId} className="text-xl font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
