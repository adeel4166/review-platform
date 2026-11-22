"use client";

import { useCallback, useEffect, useState } from "react";
import { t, type MessageKey } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { Dialog } from "../Dialog";
import { OriginalAccessDialog } from "./OriginalAccess";
import { field, primaryBtn, secondaryBtn } from "../seller/ui";

export interface QueueProof {
  id: string; reviewId: string; method: string; marketplace: string | null; slaDueAt: string | null; flags: string[] | null;
  merchantName: string | null; purchaseDate: string | null; redactionMode: string | null;
}
interface ProofDetail {
  id: string; productName: string | null; redactionMode: string | null; flags: string[] | null; merchantName: string | null; purchaseDate: string | null;
  files: { id: string; pageCount: number | null; url: string }[];
}

/** Mirrors PROOF_DECISION_REASONS in @rp/core (kept local so the client bundle stays free of server packages). */
export const REJECT_REASONS = ["UNREADABLE", "NOT_A_PURCHASE_DOCUMENT", "PRODUCT_MISMATCH", "MERCHANT_UNVERIFIABLE", "DATE_INVALID", "DUPLICATE_PROOF", "SUSPECTED_FORGERY", "OTHER"] as const;
export const BREAK_GLASS_MIN = 10;

export function proofErrorKey(e: unknown): MessageKey {
  const code = e instanceof ApiError ? e.code : "";
  return code === "CONFLICT_OF_INTEREST" ? "admin.proofs.err.coi"
    : code === "invalid_transition" || code === "proof_not_ready" || code === "review_not_verifiable" ? "admin.proofs.err.state"
    : code === "reason_required" ? "admin.proofs.err.reason" : "admin.proofs.err.generic";
}

const dueText = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

/** Moderator queue: redacted copies only (ADR-0022). Opening a proof needs a break-glass reason; every view is audited server-side. */
export function ProofsQueue({ staffId }: { staffId: string }) {
  const [items, setItems] = useState<QueueProof[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [asking, setAsking] = useState<QueueProof | null>(null);
  const [detail, setDetail] = useState<ProofDetail | null>(null);

  const load = useCallback(async () => {
    setItems(null); setFailed(false);
    try { setItems((await api<{ items: QueueProof[] }>("/api/admin/proofs?pageSize=50")).items); } catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <section aria-labelledby="proofs-h">
      <h1 id="proofs-h" className="text-2xl font-semibold">{t("admin.proofs.title")}</h1>
      <p className="mt-2 max-w-reading text-text-muted">{t("admin.proofs.intro")}</p>
      <p role={msg?.ok === false ? "alert" : "status"} className={`mt-3 ${msg?.ok === false ? "text-danger" : ""}`}>{msg?.text ?? ""}</p>
      <div aria-busy={items === null && !failed} className="mt-3">
        {failed ? (
          <p role="alert">{t("admin.proofs.error")} <button type="button" className={secondaryBtn} onClick={load}>{t("admin.proofs.retry")}</button></p>
        ) : items === null ? (
          <p>{t("admin.proofs.loading")}</p>
        ) : items.length === 0 ? (
          <p>{t("admin.proofs.empty")}</p>
        ) : (
          <div className="overflow-x-auto" role="region" aria-label={t("admin.proofs.caption")} tabIndex={0}>
            <table className="w-full text-left">
              <caption className="sr-only">{t("admin.proofs.caption")}</caption>
              <thead>
                <tr>
                  {(["method", "merchant", "date", "flags", "due", "actions"] as const).map((c) => <th key={c} scope="col" className="border-b border-border p-2 font-semibold">{t(`admin.proofs.col.${c}` as MessageKey)}</th>)}
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-b border-border">
                    <td className="p-2">{t(`proof.method.${p.method}` as MessageKey)}</td>
                    <td className="p-2">{p.merchantName ?? t("admin.proofs.unknown")}</td>
                    <td className="p-2">{p.purchaseDate ? dueText(p.purchaseDate) : "—"}</td>
                    <td className="p-2">{p.flags?.length ? p.flags.join(", ") : t("admin.proofs.noFlags")}</td>
                    <td className="p-2">{dueText(p.slaDueAt)}</td>
                    <td className="p-2"><button type="button" className={secondaryBtn} aria-haspopup="dialog" aria-label={t("admin.proofs.open.for", { id: p.id })} onClick={() => { setAsking(p); setMsg(null); }}><span aria-hidden="true">{t("admin.proofs.open")}</span></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {asking && !detail && (
        <BreakGlassDialog proof={asking} onCancel={() => setAsking(null)} onOpened={(d) => { setDetail(d); }} onError={(e) => { setAsking(null); setMsg({ ok: false, text: t(proofErrorKey(e)) }); }} />
      )}
      {asking && detail && (
        <DecisionDialog detail={detail} staffId={staffId} onClose={() => { setAsking(null); setDetail(null); }}
          onDone={async (m) => { setAsking(null); setDetail(null); setMsg({ ok: true, text: m }); await load(); }} />
      )}
    </section>
  );
}

export function validateReason(reason: string): MessageKey | null {
  return reason.trim().length < BREAK_GLASS_MIN ? "admin.proofs.bg.err.short" : null;
}

function BreakGlassDialog({ proof, onCancel, onOpened, onError }: { proof: QueueProof; onCancel: () => void; onOpened: (d: ProofDetail) => void; onError: (e: unknown) => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function open(e: React.FormEvent) {
    e.preventDefault();
    const bad = validateReason(reason);
    if (bad) { setErr(t(bad)); return; }
    setBusy(true);
    try { onOpened(await api<ProofDetail>(`/api/admin/proofs/${proof.id}`, { headers: { "X-Access-Reason": reason.trim().slice(0, 200) } })); }
    catch (e2) { onError(e2); }
    setBusy(false);
  }
  return (
    <Dialog titleId="bg-title" title={t("admin.proofs.bg.title")} onClose={onCancel}>
      <form onSubmit={open} noValidate>
        <p className="mt-2 text-text-muted">{t("admin.proofs.bg.body")}</p>
        <label htmlFor="bg-reason" className="mt-4 block font-medium">{t("admin.proofs.bg.reason")}</label>
        <textarea id="bg-reason" data-autofocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={err ? true : undefined} aria-describedby={err ? "bg-err" : undefined} className={field} />
        <p id="bg-err" role="alert" className="mt-2 text-danger">{err}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={primaryBtn}>{t("admin.proofs.bg.confirm")}</button>
          <button type="button" className={secondaryBtn} onClick={onCancel}>{t("admin.proofs.bg.cancel")}</button>
        </div>
      </form>
    </Dialog>
  );
}

function DecisionDialog({ detail, staffId, onClose, onDone }: { detail: ProofDetail; staffId: string; onClose: () => void; onDone: (msg: string) => Promise<void> }) {
  const [rejecting, setRejecting] = useState(false);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [original, setOriginal] = useState<string | null>(null);

  async function decide(outcome: "VERIFIED" | "REJECTED") {
    if (outcome === "REJECTED" && !code) { setErr(t("admin.proofs.err.reason")); return; }
    setBusy(true); setErr("");
    try {
      await api(`/api/admin/proofs/${detail.id}/decide`, { method: "POST", body: JSON.stringify({ outcome, ...(outcome === "REJECTED" ? { reasonCode: code } : {}), ...(note.trim() ? { note: note.trim() } : {}) }) });
      await onDone(t(`admin.proofs.done.${outcome}` as MessageKey));
      return;
    } catch (e) { setErr(t(proofErrorKey(e))); }
    setBusy(false);
  }

  return (
    <Dialog titleId="pd-title" title={t("admin.proofs.detail.title", { id: detail.id })} onClose={onClose} wide>
      {detail.productName && <p className="mt-2">{t("admin.proofs.detail.product", { name: detail.productName })}</p>}
      {detail.redactionMode && <p className="text-sm text-text-muted">{t("admin.proofs.detail.mode", { mode: detail.redactionMode })}</p>}
      {(detail.merchantName || detail.purchaseDate || detail.flags?.length) ? (
        <p className="mt-2 text-sm"><span className="font-medium">{t("admin.proofs.detail.ai")}:</span> {[detail.merchantName, detail.purchaseDate ? dueText(detail.purchaseDate) : null, ...(detail.flags ?? [])].filter(Boolean).join(" · ")}</p>
      ) : null}
      <h3 className="mt-4 font-semibold">{t("admin.proofs.detail.pages")}</h3>
      {detail.files.length === 0 ? <p className="mt-2">{t("admin.proofs.detail.noFiles")}</p> : (
        <ul className="mt-2 grid gap-3">
          {detail.files.map((f, i) => (
            <li key={f.id} className="relative overflow-hidden rounded-md border border-border">
              <img src={f.url} alt={t("admin.proofs.detail.page", { n: i + 1, id: detail.id })} className="block max-h-[60vh] w-full object-contain" />
              {/* R-2: visible watermark with the moderator id deters leaking screenshots. */}
              <button type="button" aria-haspopup="dialog" className={`${secondaryBtn} m-2`} onClick={() => setOriginal(f.id)}>{t("admin.bg.open", { n: i + 1 })}</button>
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center -rotate-12 select-none text-2xl font-bold text-black/20">{t("admin.proofs.detail.watermark", { id: staffId })}</span>
            </li>
          ))}
        </ul>
      )}
      {rejecting && (
        <div className="mt-4">
          <label htmlFor="pd-code" className="block font-medium">{t("admin.proofs.reject.reason")}</label>
          <select id="pd-code" value={code} onChange={(e) => setCode(e.target.value)} className={field} data-autofocus>
            <option value="">{t("admin.proofs.reject.pick")}</option>
            {REJECT_REASONS.map((r) => <option key={r} value={r}>{t(`admin.proofs.reject.reason.${r}` as MessageKey)}</option>)}
          </select>
          <label htmlFor="pd-note" className="mt-3 block font-medium">{t("admin.proofs.reject.note")}</label>
          <input id="pd-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        </div>
      )}
      <p role="alert" className="mt-3 text-danger">{err}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {rejecting ? (
          <>
            <button type="button" disabled={busy} className={primaryBtn} onClick={() => decide("REJECTED")}>{t("admin.proofs.reject.confirm")}</button>
            <button type="button" className={secondaryBtn} onClick={() => { setRejecting(false); setErr(""); }}>{t("admin.proofs.reject.cancel")}</button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy} className={primaryBtn} onClick={() => decide("VERIFIED")}>{t("admin.proofs.verify")}</button>
            <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setRejecting(true)}>{t("admin.proofs.reject")}</button>
            <button type="button" className={secondaryBtn} onClick={onClose}>{t("admin.proofs.detail.close")}</button>
          </>
        )}
      </div>
      {original && <OriginalAccessDialog proofId={detail.id} fileId={original} onClose={() => setOriginal(null)} />}
    </Dialog>
  );
}
