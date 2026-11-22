"use client";

import type { ReactNode } from "react";
import { DialogRoot, DialogContent, DialogTitle } from "./ui/primitives/dialog";

/**
 * Modal dialog (WAI-ARIA APG) on the Radix Dialog primitive: role=dialog + aria-modal, labelled, focus moves in
 * (`[data-autofocus]` first), Tab is trapped, Esc / outside press close, focus returns to the trigger (WCAG 2.4.3, 4.1.2).
 * Public API unchanged: mounted while open, `onClose` unmounts it.
 */
export function Dialog({ titleId, title, onClose, children, wide = false }: { titleId: string; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <DialogRoot open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        aria-describedby={undefined}
        className={wide ? "max-w-3xl" : "max-w-lg"}
        onOpenAutoFocus={(e) => {
          const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-autofocus]");
          if (el) { e.preventDefault(); el.focus(); }
        }}
      >
        <DialogTitle id={titleId} className="text-xl font-semibold">{title}</DialogTitle>
        {children}
      </DialogContent>
    </DialogRoot>
  );
}
