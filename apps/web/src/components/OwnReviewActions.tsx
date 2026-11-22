"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type MessageKey } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { MediaStatusList } from "./MediaStatusList";
import { ProofPanel, type OwnProof } from "./ProofPanel";
import { field, primaryBtn, secondaryBtn } from "./seller/ui";

export interface OwnReviewInfo { version: number; verified: boolean; proofs: OwnProof[]; consentVersion: string }

export function editErrorKey(e: unknown): MessageKey {
  const code = e instanceof ApiError ? e.code : "";
  return code === "version_conflict" ? "own.edit.err.version_conflict" : code === "not_editable" ? "own.edit.err.not_editable"
    : code === "rate_limited" ? "own.edit.err.rate_limited" : "own.edit.err.generic";
}

/** Client-side mirror of the first server rules; the API stays authoritative. */
export function validateEdit(title: string, body: string): MessageKey | null {
  return title.trim().length === 0 ? "own.edit.err.title" : body.trim().length < 10 ? "own.edit.err.short" : null;
}

/** Author-only block under a review: edit (versioned, goes back through moderation) and proof of purchase. */
export function OwnReviewActions({ reviewId, rating, title, body, own, level = 4 }: { reviewId: string; rating: number; title: string; body: string; own: OwnReviewInfo; level?: 3 | 4 }) {
  const H = `h${level}` as "h3" | "h4";
  const H2 = `h${level + 1}` as "h4" | "h5";
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [r, setR] = useState(rating);
  const [ti, setTi] = useState(title);
  const [bo, setBo] = useState(body);
  const [version, setVersion] = useState(own.version);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const id = `own-${reviewId}`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const bad = validateEdit(ti, bo);
    if (bad) { setErr(t(bad)); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const res = await api<{ currentVersion: number }>(`/api/reviews/${reviewId}`, { method: "PATCH", body: JSON.stringify({ expectedVersion: version, rating: r, title: ti.trim(), body: bo.trim() }) });
      setVersion(res.currentVersion);
      setEditing(false);
      setMsg(t("own.edit.saved"));
      router.refresh();
    } catch (e2) { setErr(t(editErrorKey(e2))); }
    setBusy(false);
  }

  return (
    <section aria-labelledby={`${id}-h`} className="mt-4 rounded-md border border-dashed border-border-strong p-3" data-testid="own-review-actions">
      <H id={`${id}-h`} className="text-sm font-semibold">{t("own.heading")}</H>
      <p role="status" className="mt-1 text-sm">{msg}</p>
      {editing ? (
        <form onSubmit={save} noValidate className="mt-2" aria-label={t("own.edit.title")}>
          <p className="text-sm text-text-muted">{t("own.edit.note")}</p>
          <label htmlFor={`${id}-r`} className="mt-3 block font-medium">{t("own.edit.rating")}</label>
          <select id={`${id}-r`} value={r} onChange={(e) => setR(Number(e.target.value))} className={field}>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <label htmlFor={`${id}-t`} className="mt-3 block font-medium">{t("own.edit.reviewTitle")}</label>
          <input id={`${id}-t`} value={ti} maxLength={150} onChange={(e) => setTi(e.target.value)} className={field} />
          <label htmlFor={`${id}-b`} className="mt-3 block font-medium">{t("own.edit.body")}</label>
          <textarea id={`${id}-b`} rows={5} value={bo} onChange={(e) => setBo(e.target.value)} className={field} />
          <p role="alert" className="mt-2 text-danger">{err}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={primaryBtn}>{t("own.edit.save")}</button>
            <button type="button" className={secondaryBtn} onClick={() => { setEditing(false); setErr(""); }}>{t("own.edit.cancel")}</button>
          </div>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={secondaryBtn} onClick={() => setEditing(true)}>{t("own.edit")}</button>
        </div>
      )}
      <ProofPanel Heading={H2} reviewId={reviewId} verified={own.verified} initial={own.proofs} consentVersion={own.consentVersion} />
      <MediaStatusList reviewId={reviewId} level={level === 3 ? 4 : 5} />
    </section>
  );
}
