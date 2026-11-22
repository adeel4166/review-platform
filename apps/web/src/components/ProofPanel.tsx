"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type MessageKey } from "@/i18n/en";
import { ApiError, api, putWithProgress } from "@/lib/upload";
import { field, primaryBtn, secondaryBtn } from "./seller/ui";

export interface OwnProof { id: string; status: "DRAFT" | "PENDING" | "VERIFIED" | "REJECTED" | "EXPIRED" | "WITHDRAWN"; method: string; decisionReasonCode: string | null }
type Method = "RECEIPT_UPLOAD" | "ORDER_CONFIRMATION" | "MARKETPLACE_ORDER_LINK";
const METHODS: Method[] = ["RECEIPT_UPLOAD", "ORDER_CONFIRMATION", "MARKETPLACE_ORDER_LINK"];
const MARKETPLACES = ["AMAZON", "EBAY", "ETSY", "OTHER"] as const;
const MAX_FILES = 5;

export function proofErrorKey(e: unknown): MessageKey {
  const code = e instanceof ApiError ? e.code : "";
  const known = ["proof_attempts_exhausted", "already_verified", "label_revoked", "proof_open_exists", "rate_limited"];
  return e instanceof ApiError && (e.status === 413 || e.status === 415) ? "proof.err.unsupported"
    : known.includes(code) ? (`proof.err.${code}` as MessageKey) : "proof.err.generic";
}

/** Client-side form check mirroring the server's required fields. Returns the message key of the first problem. */
export function validateProofForm(f: { method: Method; consent: boolean; files: number; orderRef: string }): MessageKey | null {
  if (f.method === "MARKETPLACE_ORDER_LINK") { if (!f.orderRef.trim()) return "proof.err.order"; }
  else if (f.files === 0) return "proof.err.files";
  return f.consent ? null : "proof.err.consent";
}

/** 'Add proof of purchase' flow on the author's own review, with the current proof's status (m4-m5-spec 5.4, 5.7). */
export function ProofPanel({ reviewId, verified, initial, consentVersion, Heading = "h5" }: { Heading?: "h4" | "h5"; reviewId: string; verified: boolean; initial: OwnProof[]; consentVersion: string }) {
  const router = useRouter();
  const [proofs, setProofs] = useState<OwnProof[]>(initial);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<Method>("RECEIPT_UPLOAD");
  const [marketplace, setMarketplace] = useState<(typeof MARKETPLACES)[number]>("AMAZON");
  const [orderRef, setOrderRef] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const id = `proof-${reviewId}`;
  const current = proofs.find((p) => p.status === "DRAFT" || p.status === "PENDING") ?? proofs[0] ?? null;
  const inProgress = current?.status === "DRAFT" || current?.status === "PENDING";

  async function reload() { setProofs(await api<OwnProof[]>(`/api/reviews/${reviewId}/proofs`)); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const bad = validateProofForm({ method, consent, files: files.length, orderRef });
    if (bad) { setErr(t(bad)); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const created = await api<{ id: string }>(`/api/reviews/${reviewId}/proofs`, {
        method: "POST",
        body: JSON.stringify({ method, consentVersion, ...(method === "MARKETPLACE_ORDER_LINK" ? { marketplace, orderReference: orderRef.trim() } : {}) }),
      });
      if (method !== "MARKETPLACE_ORDER_LINK") {
        for (const f of files) {
          setProgress(t("proof.uploading", { name: f.name }));
          const slot = await api<{ fileId: string; uploadUrl: string; headers: Record<string, string> }>(`/api/proofs/${created.id}/files`, {
            method: "POST", body: JSON.stringify({ kind: f.type === "application/pdf" ? "DOCUMENT" : "IMAGE", mimeType: f.type, sizeBytes: f.size }),
          });
          try { await putWithProgress(slot.uploadUrl, f, slot.headers, () => undefined); } catch { throw new ApiError(0, "upload"); }
          await api(`/api/proofs/${created.id}/files/${slot.fileId}/confirm`, { method: "POST" });
        }
      }
      await api(`/api/proofs/${created.id}/submit`, { method: "POST" });
      setOpen(false); setFiles([]); setConsent(false); setOrderRef(""); setProgress("");
      setMsg(t("proof.submitted"));
      await reload();
      router.refresh();
    } catch (e2) {
      setProgress("");
      setErr(t(e2 instanceof ApiError && e2.code === "upload" ? "proof.err.upload" : proofErrorKey(e2)));
      await reload().catch(() => undefined);
    }
    setBusy(false);
  }

  async function withdraw() {
    if (!current || !window.confirm(t("proof.withdraw.confirm"))) return;
    setBusy(true); setErr(""); setMsg("");
    try { await api(`/api/proofs/${current.id}`, { method: "DELETE" }); setMsg(t("proof.withdrawn")); await reload(); }
    catch (e) { setErr(t(proofErrorKey(e))); }
    setBusy(false);
  }

  return (
    <div className="mt-4 border-t border-border pt-3" data-testid="proof-panel">
      <Heading className="text-sm font-semibold">{t("proof.heading")}</Heading>
      {verified ? (
        <p className="mt-1" data-testid="proof-status">{t("proof.status")}: {t("proof.status.VERIFIED")}</p>
      ) : current && current.status !== "WITHDRAWN" ? (
        <div className="mt-1" data-testid="proof-status">
          <p><span className="font-medium">{t("proof.status")}:</span> {t(`proof.status.${current.status}` as MessageKey)}</p>
          {current.status === "REJECTED" && current.decisionReasonCode && <p className="text-sm text-text-muted">{t(`proof.reason.${current.decisionReasonCode}` as MessageKey)}</p>}
          {current.status !== "VERIFIED" && <p className="text-sm text-text-muted">{t(`proof.status.${current.status}.help` as MessageKey)}</p>}
        </div>
      ) : null}
      <p role="status" className="mt-1 text-sm">{progress || msg}</p>
      {!verified && inProgress && <div className="mt-2"><button type="button" disabled={busy} onClick={withdraw} className={secondaryBtn}>{t("proof.withdraw")}</button></div>}
      {!verified && !inProgress && !open && <div className="mt-2"><button type="button" onClick={() => { setOpen(true); setMsg(""); }} aria-expanded={false} className={secondaryBtn}>{t("proof.add")}</button></div>}
      {open && (
        <form onSubmit={submit} noValidate className="mt-2" aria-label={t("proof.add")}>
          <p className="text-sm text-text-muted">{t("proof.intro")}</p>
          <label htmlFor={`${id}-m`} className="mt-3 block font-medium">{t("proof.method")}</label>
          <select id={`${id}-m`} value={method} onChange={(e) => setMethod(e.target.value as Method)} className={field}>
            {METHODS.map((m) => <option key={m} value={m}>{t(`proof.method.${m}` as MessageKey)}</option>)}
          </select>
          {method === "MARKETPLACE_ORDER_LINK" ? (
            <>
              <label htmlFor={`${id}-mk`} className="mt-3 block font-medium">{t("proof.marketplace")}</label>
              <select id={`${id}-mk`} value={marketplace} onChange={(e) => setMarketplace(e.target.value as typeof marketplace)} className={field}>
                {MARKETPLACES.map((m) => <option key={m} value={m}>{m[0] + m.slice(1).toLowerCase()}</option>)}
              </select>
              <label htmlFor={`${id}-o`} className="mt-3 block font-medium">{t("proof.orderRef")}</label>
              <p id={`${id}-oh`} className="text-sm text-text-muted">{t("proof.orderRef.hint")}</p>
              <input id={`${id}-o`} aria-describedby={`${id}-oh`} maxLength={64} value={orderRef} onChange={(e) => setOrderRef(e.target.value)} autoComplete="off" className={field} />
            </>
          ) : (
            <>
              <label htmlFor={`${id}-f`} className="mt-3 block font-medium">{t("proof.files")}</label>
              <p id={`${id}-fh`} className="text-sm text-text-muted">{t("proof.files.hint")}</p>
              <input id={`${id}-f`} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" aria-describedby={`${id}-fh`}
                onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, MAX_FILES))} className={field} />
            </>
          )}
          <label className="mt-3 flex items-start gap-2">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-5 w-5" />
            <span>{t("proof.consent")}</span>
          </label>
          <p role="alert" className="mt-2 text-danger">{err}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={primaryBtn}>{t("proof.submit")}</button>
            <button type="button" className={secondaryBtn} onClick={() => { setOpen(false); setErr(""); }}>{t("proof.cancel")}</button>
          </div>
        </form>
      )}
      {!open && err && <p role="alert" className="mt-2 text-danger">{err}</p>}
    </div>
  );
}
