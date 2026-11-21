"use client";

import { useCallback, useEffect, useState } from "react";
import { t } from "@/i18n/en";
import {
  CASE_STATES, defaultFilters, queueQueryString, removeCase,
  type CaseState, type DecisionResult, type Filters, type QueuePage,
} from "@/lib/moderation-admin";
import { api } from "@/lib/upload";
import { AuditLog } from "./AuditLog";
import { CaseDetailLoader } from "./CaseDetail";
import { QueueList } from "./QueueList";

const input = "mt-1 block min-h-target w-full rounded-md border border-border-strong bg-surface px-3";

export function ModerationDashboard() {
  const [tab, setTab] = useState<"queue" | "audit">("queue");
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [data, setData] = useState<QueuePage | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [auditKey, setAuditKey] = useState(0);

  const load = useCallback(() => {
    setFailed(false);
    api<QueuePage>(`/api/admin/moderation?${queueQueryString(filters)}`).then(setData, () => setFailed(true));
  }, [filters]);
  useEffect(load, [load]);

  const set = (patch: Partial<Filters>) => { setData(null); setOpenId(null); setFilters((f) => ({ ...f, page: 1, ...patch })); };

  // Decision succeeded: update the list in place (no reload) and tell assistive tech.
  const onDecided = (r: Extract<DecisionResult, { ok: true }>) => {
    setData((d) => (d ? removeCase(d, r.id) : d));
    setOpenId(null);
    setNotice(t(r.state === "APPROVED" ? "mod.decision.approved" : "mod.decision.rejected"));
    setAuditKey((k) => k + 1);
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const tabBtn = (id: "queue" | "audit", label: string) => (
    <button type="button" aria-pressed={tab === id} onClick={() => setTab(id)}
      className={`min-h-target rounded-md border px-4 ${tab === id ? "border-primary bg-primary text-on-primary" : "border-border-strong bg-surface"}`}>{label}</button>
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("mod.title")}</h1>
      <div role="group" aria-label={t("mod.tabs.label")} className="mt-3 flex gap-2">
        {tabBtn("queue", t("mod.tab.queue"))}{tabBtn("audit", t("mod.tab.audit"))}
      </div>
      <p role="status" className="mt-2 min-h-[1.5rem] text-sm">{notice}</p>

      {tab === "audit" ? <AuditLog refreshKey={auditKey} /> : (
        <>
          <form className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => e.preventDefault()}>
            <div>
              <label htmlFor="f-state" className="text-sm font-medium">{t("mod.filter.state")}</label>
              <select id="f-state" className={input} value={filters.state} onChange={(e) => set({ state: e.target.value as CaseState })}>
                {CASE_STATES.map((s) => <option key={s} value={s}>{t(`mod.state.${s}`)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="f-min" className="text-sm font-medium">{t("mod.filter.minScore")}</label>
              <input id="f-min" inputMode="decimal" className={input} value={filters.minScore} onChange={(e) => set({ minScore: e.target.value })} />
            </div>
            <div>
              <label htmlFor="f-max" className="text-sm font-medium">{t("mod.filter.maxScore")}</label>
              <input id="f-max" inputMode="decimal" className={input} value={filters.maxScore} onChange={(e) => set({ maxScore: e.target.value })} />
            </div>
            <div>
              <label htmlFor="f-media" className="text-sm font-medium">{t("mod.filter.media")}</label>
              <select id="f-media" className={input} value={filters.hasMedia} onChange={(e) => set({ hasMedia: e.target.value as Filters["hasMedia"] })}>
                {(["any", "true", "false"] as const).map((v) => <option key={v} value={v}>{t(`mod.filter.media.${v}`)}</option>)}
              </select>
            </div>
          </form>

          {failed ? <p role="alert" className="mt-4">{t("mod.loadError")} <button type="button" className="text-link underline" onClick={load}>{t("mod.retry")}</button></p>
            : !data ? <p role="status" className="mt-4">{t("mod.loading")}</p> : (
              <>
                <p className="mt-3 text-text-muted">{t("mod.count", { total: data.total })}</p>
                <div className="mt-2 grid gap-6 lg:grid-cols-2">
                  <QueueList items={data.items} selectedId={openId} onOpen={(id) => { setNotice(""); setOpenId(id); }} />
                  {openId && <CaseDetailLoader id={openId} onDecided={onDecided} onConflict={() => { setOpenId(null); load(); }} onClose={() => setOpenId(null)} />}
                </div>
                {pages > 1 && (
                  <div className="mt-4 flex items-center gap-3">
                    <button type="button" disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })} className="min-h-target rounded-md border border-border-strong px-3 disabled:opacity-60">{t("pagination.prev")}</button>
                    <span>{t("mod.page", { page: filters.page, pages })}</span>
                    <button type="button" disabled={filters.page >= pages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })} className="min-h-target rounded-md border border-border-strong px-3 disabled:opacity-60">{t("pagination.next")}</button>
                  </div>
                )}
              </>
            )}
        </>
      )}
    </div>
  );
}
