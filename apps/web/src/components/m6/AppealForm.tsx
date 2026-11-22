"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { t, type MessageKey } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { field, primaryBtn, secondaryBtn } from "../seller/ui";

export const STATEMENT_MIN = 10;
export const STATEMENT_MAX = 2000;
export function validateAppeal(statement: string, understood: boolean): MessageKey | null {
  const n = statement.trim().length;
  return n < STATEMENT_MIN ? "appeal.err.short" : n > STATEMENT_MAX ? "appeal.err.long" : !understood ? "appeal.err.understood" : null;
}
export function appealErrorKey(e: unknown): MessageKey {
  const c = e instanceof ApiError ? e.code : "";
  return c === "appeal_window_closed" ? "appeal.err.closed" : c === "appeal_exists" ? "appeal.err.exists" : c === "rate_limited" ? "appeal.err.rate" : c === "version_superseded" ? "appeal.err.superseded" : "appeal.err.generic";
}

/** 11.2 Appeal form. The decision summary is passed in (no re-entry, WCAG 3.3.7); the draft is kept in sessionStorage. */
export function AppealForm({ caseId, summary }: { caseId: string; summary: string }) {
  const router = useRouter();
  const key = `appeal-draft:${caseId}`;
  const [statement, setStatement] = useState(() => (typeof window === "undefined" ? "" : window.sessionStorage.getItem(key) ?? ""));
  const [understood, setUnderstood] = useState(false);
  const [err, setErr] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const bad = validateAppeal(statement, understood);
    if (bad) { setErr(bad); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api<{ id: string }>("/api/appeals", { method: "POST", body: JSON.stringify({ caseId, statement: statement.trim() }) });
      window.sessionStorage.removeItem(key);
      router.push(`/appeals/${r.id}?received=1`);
    } catch (e2) { setErr(appealErrorKey(e2)); setBusy(false); }
  }
  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-4">
      {err && <div role="alert" className="rounded-md border border-danger p-3"><p className="font-semibold">{t("appeal.err.summary")}</p><p>{t(err)}</p></div>}
      <details className="rounded-md border border-border p-3"><summary className="cursor-pointer font-medium">{t("appeal.summary")}</summary><p className="mt-2">{summary}</p></details>
      <div>
        <label htmlFor="ap-statement" className="font-medium">{t("appeal.statement")}</label>
        <p id="ap-hint" className="text-sm text-text-muted">{t("appeal.hint")}</p>
        <textarea id="ap-statement" rows={6} maxLength={STATEMENT_MAX} value={statement} aria-describedby="ap-hint ap-count" aria-invalid={err && err.startsWith("appeal.err.s") ? true : undefined}
          onChange={(e) => { setStatement(e.target.value); window.sessionStorage.setItem(key, e.target.value); }} className={field} />
        <p id="ap-count" className="text-sm text-text-muted">{statement.length}/{STATEMENT_MAX}</p>
      </div>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 h-5 w-5" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />{t("appeal.understood")}</label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={primaryBtn}>{t("appeal.submit")}</button>
        <button type="button" className={secondaryBtn} onClick={() => router.back()}>{t("appeal.cancel")}</button>
      </div>
    </form>
  );
}
