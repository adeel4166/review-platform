"use client";

import { useState } from "react";
import { t, type MessageKey } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { StepUpFields, stepUp } from "../account/StepUpFields";
import { Dialog } from "../Dialog";
import { field, primaryBtn, secondaryBtn } from "../seller/ui";

/** Mirrors REASON_MIN / REASON_MAX in @rp/core break-glass (ADR-0027); the server stays authoritative. */
export const ORIGINAL_REASON_MIN = 20;
export const ORIGINAL_REASON_MAX = 500;
export const ORIGINAL_REASON_CODES = ["FRAUD_SUSPECTED", "REDACTION_FAILED", "APPEAL_EVIDENCE", "LEGAL_REQUEST", "OTHER"] as const;

export function validateOriginalReason(text: string): MessageKey | null {
  const n = [...text.trim()].length;
  return n < ORIGINAL_REASON_MIN ? "admin.bg.err.short" : n > ORIGINAL_REASON_MAX ? "admin.bg.err.long" : null;
}

/** Maps the server's break-glass error codes to copy (the server enforces; this only explains). */
export function originalAccessErrorKey(e: unknown): MessageKey {
  const code = e instanceof ApiError ? e.code : "";
  switch (code) {
    case "reason_invalid": return "admin.bg.err.short";
    case "step_up_required": return "admin.bg.err.stepUp";
    case "conflict_of_interest": case "CONFLICT_OF_INTEREST": return "admin.bg.err.coi";
    case "original_purged": return "admin.bg.err.purged";
    case "break_glass_cap": return "admin.bg.err.cap";
    case "forbidden": return "admin.bg.err.forbidden";
    default: return "admin.bg.err.generic";
  }
}

/** POST /original-access (reason + step-up + daily cap enforced server-side). 201 -> open the single-use, 60 s content URL; 202 -> second approver needed. */
export function OriginalAccessDialog({ proofId, fileId, onClose }: { proofId: string; fileId: string; onClose: () => void }) {
  const [code, setCode] = useState<string>(ORIGINAL_REASON_CODES[0]);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [needStepUp, setNeedStepUp] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const bad = validateOriginalReason(text);
    if (bad) { setErr(t(bad)); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const fd = new FormData(e.currentTarget);
      const pw = String(fd.get("stepUpPassword") ?? "");
      if (needStepUp && pw) await stepUp(pw, String(fd.get("stepUpCode") ?? "") || undefined);
      const r = await api<{ status: number; accessId?: string; approvalRequestId?: string }>(`/api/admin/proofs/${proofId}/files/${fileId}/original-access`, { method: "POST", body: JSON.stringify({ reasonCode: code, reasonText: text.trim() }) });
      if (r.accessId) { window.open(`/api/admin/break-glass/${r.accessId}/content`, "_blank", "noopener,noreferrer"); setMsg(t("admin.bg.opened")); }
      else setMsg(t("admin.bg.needsApproval"));
    } catch (e2) {
      if (e2 instanceof ApiError && e2.code === "step_up_required") setNeedStepUp(true);
      setErr(t(originalAccessErrorKey(e2)));
    }
    setBusy(false);
  }

  return (
    <Dialog titleId="og-title" title={t("admin.bg.title")} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-3">
        <p className="mt-2 text-text-muted">{t("admin.bg.body")}</p>
        <div>
          <label htmlFor="og-code" className="font-medium">{t("admin.bg.code")}</label>
          <select id="og-code" value={code} onChange={(e) => setCode(e.target.value)} className={field}>
            {ORIGINAL_REASON_CODES.map((c) => <option key={c} value={c}>{t(`admin.bg.code.${c}` as MessageKey)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="og-text" className="font-medium">{t("admin.bg.reason", { min: ORIGINAL_REASON_MIN })}</label>
          <textarea id="og-text" data-autofocus rows={3} maxLength={ORIGINAL_REASON_MAX} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={err ? true : undefined} aria-describedby="og-msg" className={field} />
        </div>
        {needStepUp && <StepUpFields idPrefix="og" />}
        <p id="og-msg" role="alert" className="text-danger">{err}</p>
        <p role="status">{msg}</p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={primaryBtn}>{t("admin.bg.confirm")}</button>
          <button type="button" className={secondaryBtn} onClick={onClose}>{t("admin.bg.close")}</button>
        </div>
      </form>
    </Dialog>
  );
}
