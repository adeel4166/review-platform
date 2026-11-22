"use client";

import { useEffect, useId, useState } from "react";
import { t, type MessageKey } from "@/i18n/en";

export type VerificationMethod = "RECEIPT_UPLOAD" | "ORDER_CONFIRMATION" | "MARKETPLACE_ORDER_LINK";

export function verifiedLabel(method?: VerificationMethod | string | null): string {
  const key = `review.verifiedPurchase.${method}` as MessageKey;
  return method ? t(key) : t("review.verifiedPurchase");
}

/**
 * "Verified purchase · <method>" with a methodology popover (WCAG 1.4.13: dismissible with Esc, hoverable, persistent,
 * and reachable by keyboard/tap through the info button). The label is text, never colour alone.
 */
export function VerifiedBadge({ method }: { method?: VerificationMethod | string | null }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <span className="relative inline-flex items-center gap-1" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-sm font-medium text-success" data-testid="verified-badge">
        <span aria-hidden="true">✓</span>
        {verifiedLabel(method)}
      </span>
      <button type="button" aria-expanded={open} aria-controls={id} aria-label={t("review.verified.info")} onClick={() => setOpen((o) => !o)}
        className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-border-strong text-xs text-text-muted"><span aria-hidden="true">i</span></button>
      {open && (
        <span id={id} role="note" className="absolute left-0 top-full z-10 mt-1 w-64 rounded-md border border-border bg-surface p-3 text-sm text-text shadow-lg">
          {t("review.verified.tip")}{" "}
          <a href="/trust/verified-purchases" className="text-link underline">{t("review.verified.learn")}</a>
        </span>
      )}
    </span>
  );
}
