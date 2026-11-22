"use client";

import { useState } from "react";
import { t, type MessageKey } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { StepUpFields, stepUp } from "../account/StepUpFields";
import { Dialog } from "../Dialog";
import { field, primaryBtn, secondaryBtn } from "../seller/ui";

export const ACTIONS = ["SELLER_SUSPENSION", "SELLER_REPLY_RESTRICTION", "USER_REPLY_RESTRICTION"] as const;
export type EnforcementKind = (typeof ACTIONS)[number];
export const pathFor = (k: EnforcementKind, id: string) =>
  k === "SELLER_SUSPENSION" ? `/api/admin/sellers/${id}/suspend` : k === "SELLER_REPLY_RESTRICTION" ? `/api/admin/sellers/${id}/reply-restriction` : `/api/admin/users/${id}/reply-restriction`;
export function validateEnforcement(v: { targetId: string; reasonCode: string; publicReason: string }): MessageKey | null {
  return !v.targetId.trim() ? "enf.err.target" : !/^[A-Z0-9_]{3,64}$/.test(v.reasonCode) ? "enf.err.code" : v.publicReason.trim().length < 3 ? "enf.err.reason" : null;
}

/** Enforcement actions: reason code + public reason (statement of reasons), then a confirm dialog with step-up (destructive action, WCAG 3.3.4). */
export function EnforcementForm() {
  const [kind, setKind] = useState<EnforcementKind>("SELLER_REPLY_RESTRICTION");
  const [targetId, setTargetId] = useState("");
  const [reasonCode, setReasonCode] = useState("POLICY_VIOLATION");
  const [publicReason, setPublicReason] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  function review(e: React.FormEvent) {
    e.preventDefault();
    const bad = validateEnforcement({ targetId, reasonCode, publicReason });
    if (bad) { setErr(t(bad)); return; }
    setErr(""); setMsg(""); setConfirm(true);
  }
  async function issue(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true); setErr("");
    try {
      await stepUp(String(fd.get("stepUpPassword") ?? ""), String(fd.get("stepUpCode") ?? "") || undefined);
      await api(pathFor(kind, targetId.trim()), { method: "POST", body: JSON.stringify({ reasonCode, publicReason: publicReason.trim(), ...(endsAt ? { endsAt: new Date(endsAt).toISOString() } : {}) }) });
      setConfirm(false); setMsg(t("enf.done")); setTargetId(""); setPublicReason("");
    } catch (e2) { setErr(t(e2 instanceof ApiError && (e2.status === 401 || e2.status === 403) ? "enf.err.auth" : "enf.err.generic")); }
    setBusy(false);
  }
  return (
    <section aria-labelledby="enf-h">
      <h1 id="enf-h" className="text-2xl font-semibold">{t("enf.h1")}</h1>
      <p className="mt-2 max-w-reading text-text-muted">{t("enf.intro")}</p>
      <p role="status" className="mt-2 min-h-[1.5rem]">{msg}</p>
      <form onSubmit={review} noValidate className="mt-2 max-w-xl space-y-3">
        {err && !confirm && <p role="alert" className="text-danger">{err}</p>}
        <div><label htmlFor="enf-kind" className="font-medium">{t("enf.kind")}</label>
          <select id="enf-kind" value={kind} onChange={(e) => setKind(e.target.value as EnforcementKind)} className={field}>{ACTIONS.map((a) => <option key={a} value={a}>{t(`enf.kind.${a}` as MessageKey)}</option>)}</select></div>
        <div><label htmlFor="enf-target" className="font-medium">{t("enf.target")}</label><input id="enf-target" value={targetId} onChange={(e) => setTargetId(e.target.value)} className={field} /></div>
        <div><label htmlFor="enf-code" className="font-medium">{t("enf.code")}</label><input id="enf-code" value={reasonCode} onChange={(e) => setReasonCode(e.target.value.toUpperCase())} className={field} /></div>
        <div><label htmlFor="enf-reason" className="font-medium">{t("enf.reason")}</label><textarea id="enf-reason" rows={3} maxLength={2000} value={publicReason} onChange={(e) => setPublicReason(e.target.value)} className={field} /></div>
        <div><label htmlFor="enf-ends" className="font-medium">{t("enf.ends")}</label><input id="enf-ends" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={field} /></div>
        <button type="submit" className={primaryBtn} aria-haspopup="dialog">{t("enf.review")}</button>
      </form>
      {confirm && (
        <Dialog titleId="enf-title" title={t("enf.confirm.title")} onClose={() => setConfirm(false)}>
          <form onSubmit={issue} className="space-y-3">
            <p className="mt-2">{t("enf.confirm.body", { kind: t(`enf.kind.${kind}` as MessageKey), id: targetId })}</p>
            <StepUpFields idPrefix="enf" withCode />
            <p role="alert" className="text-danger">{err}</p>
            <div className="flex gap-2"><button type="submit" disabled={busy} className={primaryBtn}>{t("enf.confirm.go")}</button><button type="button" className={secondaryBtn} onClick={() => setConfirm(false)}>{t("appeal.cancel")}</button></div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
