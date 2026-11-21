"use client";

import { useCallback, useEffect, useState } from "react";
import { t, type MessageKey } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";

export type ClaimTab = "review" | "contested" | "spot_check";
export interface QueueClaim {
  id: string; sellerId: string; seller?: { name: string }; scope: string; method: string; status: string; domain: string | null;
  requiresHumanReview: boolean; requiredApprovals: number; conflictClaimId: string | null; lastCheckOutcome: string | null; createdAt: string;
}
type Action = "approve" | "reject" | "request_info" | "spot_check_pass" | "spot_check_fail";

const TABS: ClaimTab[] = ["review", "contested", "spot_check"];
const btn = "min-h-target rounded-md border border-border-strong bg-surface px-3 font-medium disabled:opacity-60";

export function errorKeyFor(e: unknown): MessageKey {
  const code = e instanceof ApiError ? e.code : "";
  return code === "self_decision_forbidden" ? "admin.claims.err.self"
    : code === "CONFLICT_OF_INTEREST" ? "admin.claims.err.coi"
    : code === "contest_window_open" ? "admin.claims.err.window"
    : code === "invalid_transition" ? "admin.claims.err.state"
    : "admin.claims.err.generic";
}

export function ClaimsQueue() {
  const [tab, setTab] = useState<ClaimTab>("review");
  const [items, setItems] = useState<QueueClaim[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async (which: ClaimTab) => {
    setItems(null);
    setFailed(false);
    try {
      setItems((await api<{ items: QueueClaim[] }>(`/api/admin/claims?tab=${which}&pageSize=50`)).items);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => { void load(tab); }, [tab, load]);

  async function decide(c: QueueClaim, action: Action) {
    if (action === "reject" && !/^[A-Z0-9_]{3,64}$/.test(reason)) { setMsg({ ok: false, text: t("admin.claims.err.validation") }); return; }
    setBusyId(c.id);
    setMsg(null);
    try {
      const body: Record<string, string> = { action };
      if (action === "reject") body.reasonCode = reason;
      if (note.trim()) body.note = note.trim();
      const r = await api<{ status: string; contested: boolean }>(`/api/admin/claims/${c.id}/decision`, { method: "POST", body: JSON.stringify(body) });
      const key: MessageKey = r.contested ? "admin.claims.done.contested" : action === "approve" ? "admin.claims.done.approve" : action === "reject" ? "admin.claims.done.reject" : action === "request_info" ? "admin.claims.done.request_info" : "admin.claims.done.other";
      setMsg({ ok: true, text: t(key) });
      setRejecting(null); setReason(""); setNote("");
      await load(tab);
    } catch (e) {
      setMsg({ ok: false, text: t(errorKeyFor(e)) });
    }
    setBusyId(null);
  }

  const label = (a: MessageKey, c: QueueClaim) => t("admin.claims.for", { action: t(a), id: c.id });
  const now = Date.now();

  return (
    <section aria-labelledby="claims-h">
      <h1 id="claims-h" className="text-2xl font-semibold">{t("admin.claims.title")}</h1>
      <div role="group" aria-label={t("admin.claims.tabs")} className="mt-4 flex flex-wrap gap-2">
        {TABS.map((k) => (
          <button key={k} type="button" aria-pressed={tab === k} onClick={() => { setTab(k); setMsg(null); setRejecting(null); }}
            className={`${btn} ${tab === k ? "border-primary font-semibold" : ""}`}>{t(`admin.claims.tab.${k}` as MessageKey)}</button>
        ))}
      </div>
      <p role={msg?.ok === false ? "alert" : "status"} className={`mt-3 ${msg?.ok === false ? "text-danger" : ""}`}>{msg?.text ?? ""}</p>

      <div aria-busy={items === null && !failed} className="mt-3">
        {failed && (
          <p role="alert" className="text-danger">{t("admin.claims.error")} <button type="button" className={btn} onClick={() => load(tab)}>{t("admin.claims.retry")}</button></p>
        )}
        {items === null && !failed && <p>{t("admin.claims.loading")}</p>}
        {items?.length === 0 && <p>{t("admin.claims.empty")}</p>}
        {items && items.length > 0 && (
          <div className="overflow-x-auto" role="region" aria-label={t("admin.claims.caption")} tabIndex={0}>
            <table className="w-full text-left">
              <caption className="sr-only">{t("admin.claims.caption")}</caption>
              <thead><tr>
                {(["seller", "method", "scope", "age", "flags", "actions"] as const).map((c) => <th key={c} scope="col" className="py-1 pr-4">{t(`admin.claims.col.${c}` as MessageKey)}</th>)}
              </tr></thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-t border-border align-top" data-testid={`claim-${c.id}`}>
                    <th scope="row" className="py-2 pr-4 font-normal">{c.seller?.name ?? c.sellerId}{c.domain ? <span className="block text-sm text-text-muted">{c.domain}</span> : null}</th>
                    <td className="py-2 pr-4">{t(`claim.method.${c.method}` as MessageKey)}</td>
                    <td className="py-2 pr-4">{c.scope}</td>
                    <td className="py-2 pr-4">{t("admin.claims.age", { days: Math.max(0, Math.floor((now - Date.parse(c.createdAt)) / 86_400_000)) })}</td>
                    <td className="py-2 pr-4 text-sm">
                      <ul>
                        {c.conflictClaimId && <li>⚠ {t("admin.claims.flag.conflict")}</li>}
                        {c.requiresHumanReview && <li>{t("admin.claims.flag.human")}</li>}
                        {c.requiredApprovals > 1 && <li>{t("admin.claims.flag.approvals", { n: c.requiredApprovals })}</li>}
                        {c.lastCheckOutcome && <li>{t("admin.claims.flag.check", { outcome: t(`claim.outcome.${c.lastCheckOutcome}` as MessageKey) })}</li>}
                      </ul>
                    </td>
                    <td className="py-2">
                      {rejecting === c.id ? (
                        <div className="max-w-xs space-y-2">
                          <label htmlFor={`rc-${c.id}`} className="block text-sm font-medium">{t("admin.claims.reason")}</label>
                          <input id={`rc-${c.id}`} value={reason} onChange={(e) => setReason(e.target.value.toUpperCase())} aria-describedby={`rch-${c.id}`} maxLength={64}
                            className="block w-full min-h-target rounded-md border border-border-strong bg-surface px-2" />
                          <p id={`rch-${c.id}`} className="text-sm text-text-muted">{t("admin.claims.reasonHint")}</p>
                          <label htmlFor={`nt-${c.id}`} className="block text-sm font-medium">{t("admin.claims.note")}</label>
                          <textarea id={`nt-${c.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} className="block w-full rounded-md border border-border-strong bg-surface px-2 py-1" />
                          <div className="flex gap-2">
                            <button type="button" className={`${btn} bg-primary text-on-primary`} disabled={busyId === c.id} onClick={() => decide(c, "reject")}>{t("admin.claims.confirmReject")}</button>
                            <button type="button" className={btn} onClick={() => setRejecting(null)}>{t("admin.claims.cancel")}</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {tab === "spot_check" ? (
                            <>
                              <button type="button" className={btn} disabled={busyId === c.id} aria-label={label("admin.claims.passCheck", c)} onClick={() => decide(c, "spot_check_pass")}>{t("admin.claims.passCheck")}</button>
                              <button type="button" className={btn} disabled={busyId === c.id} aria-label={label("admin.claims.failCheck", c)} onClick={() => decide(c, "spot_check_fail")}>{t("admin.claims.failCheck")}</button>
                            </>
                          ) : (
                            <>
                              <button type="button" className={`${btn} bg-primary text-on-primary`} disabled={busyId === c.id} aria-label={label("admin.claims.approve", c)} onClick={() => decide(c, "approve")}>{t("admin.claims.approve")}</button>
                              <button type="button" className={btn} disabled={busyId === c.id} aria-label={label("admin.claims.reject", c)} onClick={() => { setRejecting(c.id); setMsg(null); }}>{t("admin.claims.reject")}</button>
                              <button type="button" className={btn} disabled={busyId === c.id} aria-label={label("admin.claims.requestInfo", c)} onClick={() => decide(c, "request_info")}>{t("admin.claims.requestInfo")}</button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
