"use client";

import { useCallback, useEffect, useState } from "react";
import { t, type MessageKey } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { StepUpFields, stepUp } from "../account/StepUpFields";
import { field, primaryBtn, secondaryBtn } from "../seller/ui";
import { dateText } from "./format";

export interface PendingApproval { id: string; kind: string; requestedById: string; targetKey: string; expiresAt: string; createdAt: string }
export function approvalErrorKey(e: unknown): MessageKey {
  const c = e instanceof ApiError ? e.code : "";
  return c === "approval_self" ? "ap4.err.self" : c === "step_up_required" ? "ap4.err.stepUp" : c === "payload_changed" ? "ap4.err.changed" : "ap4.err.generic";
}

/** Four-eyes (ADR-0026): another admin approves or rejects; the requester cannot approve their own request (server enforces, UI hides the button). */
export function StaffApprovals({ staffId }: { staffId: string }) {
  const [items, setItems] = useState<PendingApproval[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [needStepUp, setNeedStepUp] = useState(false);
  const [version, setVersion] = useState("");
  const load = useCallback(() => { api<{ items: PendingApproval[] }>("/api/admin/approvals").then((r) => setItems(r.items), () => setItems([])); }, []);
  useEffect(load, [load]);

  async function act(id: string, what: "approve" | "reject", e?: React.FormEvent<HTMLFormElement>) {
    try {
      const pw = e ? String(new FormData(e.currentTarget).get("stepUpPassword") ?? "") : "";
      if (pw) await stepUp(pw);
      await api(`/api/admin/approvals/${id}/${what}`, { method: "POST", body: "{}" });
      setMsg({ ok: true, text: t(what === "approve" ? "ap4.approved" : "ap4.rejected") }); setNeedStepUp(false); load();
    } catch (e2) { if (e2 instanceof ApiError && e2.code === "step_up_required") setNeedStepUp(true); setMsg({ ok: false, text: t(approvalErrorKey(e2)) }); }
  }
  async function requestActivation(e: React.FormEvent) {
    e.preventDefault();
    if (!version.trim()) { setMsg({ ok: false, text: t("ap4.err.version") }); return; }
    try { await api(`/api/admin/config/moderation/${encodeURIComponent(version.trim())}/activation-requests`, { method: "POST", body: "{}" }); setMsg({ ok: true, text: t("ap4.requested") }); setVersion(""); load(); }
    catch (e2) { setMsg({ ok: false, text: t(approvalErrorKey(e2)) }); }
  }
  return (
    <section aria-labelledby="ap4-h">
      <h1 id="ap4-h" className="text-2xl font-semibold">{t("ap4.h1")}</h1>
      <p className="mt-2 max-w-reading text-text-muted">{t("ap4.intro")}</p>
      <p role={msg?.ok === false ? "alert" : "status"} className="mt-2 min-h-[1.5rem]">{msg?.text ?? ""}</p>
      <form onSubmit={requestActivation} className="mt-3 flex flex-wrap items-end gap-2" noValidate>
        <div><label htmlFor="ap4-version" className="font-medium">{t("ap4.version")}</label><input id="ap4-version" value={version} maxLength={32} onChange={(e) => setVersion(e.target.value)} className={field} /></div>
        <button type="submit" className={secondaryBtn}>{t("ap4.request")}</button>
      </form>
      <h2 className="mt-6 text-lg font-semibold">{t("ap4.pending")}</h2>
      {!items ? <p role="status">{t("mod.loading")}</p> : items.length === 0 ? <p>{t("ap4.empty")}</p> : (
        <ul className="mt-2 space-y-3">
          {items.map((r) => (
            <li key={r.id} className="rounded-lg border border-border bg-surface p-3" data-testid="approval-row">
              <p className="font-semibold">{t(`ap4.kind.${r.kind}` as MessageKey)}</p>
              <p className="text-sm text-text-muted">{t("ap4.target", { target: r.targetKey, date: dateText(r.expiresAt) })}</p>
              {r.requestedById === staffId ? <p>{t("ap4.yours")}</p> : (
                <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); void act(r.id, "approve", e); }}>
                  {needStepUp && <StepUpFields idPrefix={`ap-${r.id}`} />}
                  <div className="flex gap-2"><button type="submit" className={primaryBtn}>{t("ap4.approve")}</button><button type="button" className={secondaryBtn} onClick={() => act(r.id, "reject")}>{t("ap4.reject")}</button></div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
