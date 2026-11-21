"use client";

import { useState } from "react";
import { t } from "@/i18n/en";

export const field = "mt-1 block w-full min-h-target rounded-md border border-border-strong bg-surface px-3 py-2";
export const primaryBtn = "inline-flex min-h-target items-center justify-center rounded-md bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60";
export const secondaryBtn = "inline-flex min-h-target items-center justify-center rounded-md border border-border-strong bg-surface px-4 py-2 font-medium disabled:opacity-60";

/** Copy button with a polite live-region confirmation (WCAG 4.1.3); falls back to a message when the clipboard is blocked. */
export function CopyButton({ text, what }: { text: string; what: string }) {
  const [msg, setMsg] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(t("claim.copied"));
    } catch {
      setMsg(t("claim.copyFailed"));
    }
  }
  return (
    <>
      <button type="button" onClick={copy} className={secondaryBtn} aria-label={t("claim.copy.for", { what })}>{t("claim.copy")}</button>
      <span role="status" className="ml-2 text-sm text-text-muted">{msg}</span>
    </>
  );
}

export function formatDate(d: string | Date): string {
  return new Date(d).toISOString().slice(0, 10); // fixed format: identical on server and client (no hydration drift)
}
