"use client";

import { useCallback, useEffect, useState } from "react";
import { t, type MessageKey } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { Dialog } from "../Dialog";
import { field, primaryBtn, secondaryBtn } from "../seller/ui";
import { dateText } from "./format";
import { QueueEmpty, QueueError, QueueLoading } from "../admin/QueueStates";

export interface QueueAppeal {
  id: string; status: string; appellant: string; statement: string; slaDueAt: string; overdue: boolean; holdExpired: boolean; title: string | null;
  originalReason: string | null; heldByMe: boolean; leaseExpiresAt: string | null; conflict: boolean;
}
export const OUTCOMES = ["UPHELD", "OVERTURNED", "PARTIALLY_OVERTURNED"] as const;
export function staffAppealErrorKey(e: unknown): MessageKey {
  const c = e instanceof ApiError ? e.code : "";
  return c === "CONFLICT_OF_INTEREST" ? "sa.err.coi" : c === "lease_not_held" ? "sa.err.lease" : c === "version_superseded" ? "sa.err.superseded" : "sa.err.generic";
}

/** 07 §7.2 appeal queue: HOLD_EXPIRED first (server order), SLA as text + icon, guard banner, claim then decide with a note. */
export function StaffAppeals() {
  const [items, setItems] = useState<QueueAppeal[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deciding, setDeciding] = useState<QueueAppeal | null>(null);
  const load = useCallback(() => { setFailed(false); api<{ items: QueueAppeal[] }>("/api/admin/appeals").then((r) => setItems(r.items), () => setFailed(true)); }, []);
  useEffect(load, [load]);

  async function claim(a: QueueAppeal) {
    try { await api(`/api/admin/appeals/${a.id}/claim`, { method: "POST", body: "{}" }); setMsg({ ok: true, text: t("sa.claimed") }); setDeciding(a); load(); }
    catch (e) { setMsg({ ok: false, text: t(staffAppealErrorKey(e)) }); }
  }
  return (
    <section aria-labelledby="sa-h">
      <h1 id="sa-h" className="text-2xl font-semibold">{t("sa.h1")}</h1>
      <p role={msg?.ok === false ? "alert" : "status"} className="mt-2 min-h-[1.5rem]">{msg?.text ?? ""}</p>
      {failed ? <QueueError>{t("sa.error")} <button type="button" className={secondaryBtn} onClick={load}>{t("mod.retry")}</button></QueueError>
        : !items ? <QueueLoading label={t("mod.loading")} /> : items.length === 0 ? <QueueEmpty message={t("sa.empty")} /> : (
          <div role="region" aria-label={t("sa.caption")} tabIndex={0} className="overflow-x-auto">
            <table className="w-full text-left">
              <caption className="sr-only">{t("sa.caption")}</caption>
              <thead><tr>{(["appellant", "content", "original", "sla", "status", "actions"] as const).map((c) => <th key={c} scope="col" className="border-b border-border p-2">{t(`sa.col.${c}` as MessageKey)}</th>)}</tr></thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="border-b border-border align-top" data-testid="appeal-row">
                    <td className="p-2">@{a.appellant}</td>
                    <td className="p-2">{a.title ?? t("notice.reply")}</td>
                    <td className="p-2">{a.holdExpired ? <strong>{t("sa.holdExpired")}</strong> : a.originalReason ?? "—"}</td>
                    <td className="p-2"><span aria-hidden="true">{a.overdue ? "⚠ " : "⏱ "}</span>{a.overdue ? t("sa.overdue", { date: dateText(a.slaDueAt) }) : t("sa.due", { date: dateText(a.slaDueAt) })}</td>
                    <td className="p-2">{a.heldByMe ? t("sa.heldByYou", { date: dateText(a.leaseExpiresAt) }) : t(`sa.status.${a.status}` as MessageKey)}</td>
                    <td className="p-2">
                      {a.conflict ? <p data-testid="appeal-guard">{t("sa.guard")}</p>
                        : a.heldByMe ? <button type="button" className={primaryBtn} aria-haspopup="dialog" onClick={() => setDeciding(a)}>{t("sa.decide")}<span className="sr-only">: @{a.appellant}</span></button>
                        : <button type="button" className={secondaryBtn} onClick={() => claim(a)}>{t("sa.claim")}<span className="sr-only">: @{a.appellant}</span></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {deciding && <DecideDialog appeal={deciding} onClose={() => setDeciding(null)} onDone={(text) => { setDeciding(null); setMsg({ ok: true, text }); load(); }} />}
    </section>
  );
}

function DecideDialog({ appeal, onClose, onDone }: { appeal: QueueAppeal; onClose: () => void; onDone: (m: string) => void }) {
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>("UPHELD");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) { setErr(t("sa.err.note")); return; }
    setBusy(true); setErr("");
    try {
      const r = await api<{ status?: number }>(`/api/admin/appeals/${appeal.id}/decide`, { method: "POST", body: JSON.stringify({ outcome, decisionNote: note.trim() }) });
      onDone(r.status === 202 ? t("sa.needsApproval") : t("sa.decided"));
    } catch (e2) { setErr(t(staffAppealErrorKey(e2))); setBusy(false); }
  }
  return (
    <Dialog titleId="da-title" title={t("sa.decide.title", { who: appeal.appellant })} onClose={onClose} wide>
      <form onSubmit={submit} noValidate className="space-y-3">
        <p className="mt-2"><span className="font-medium">{t("sa.statement")}:</span> {appeal.statement}</p>
        <fieldset><legend className="font-medium">{t("sa.outcome")}</legend>
          {OUTCOMES.map((o) => <label key={o} className="flex min-h-target items-center gap-2"><input type="radio" name="outcome" checked={outcome === o} onChange={() => setOutcome(o)} />{t(`sa.outcome.${o}` as MessageKey)}</label>)}
        </fieldset>
        <div><label htmlFor="da-note" className="font-medium">{t("sa.note")}</label><textarea id="da-note" data-autofocus rows={4} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={field} /></div>
        <p role="alert" className="text-danger">{err}</p>
        <div className="flex gap-2"><button type="submit" disabled={busy} className={primaryBtn}>{t("sa.decide.confirm")}</button><button type="button" className={secondaryBtn} onClick={onClose}>{t("appeal.cancel")}</button></div>
      </form>
    </Dialog>
  );
}
