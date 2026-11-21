"use client";

import { useCallback, useEffect, useState } from "react";
import { t } from "@/i18n/en";
import type { AuditItem } from "@/lib/moderation-admin";
import { api } from "@/lib/upload";

export function AuditTable({ items }: { items: AuditItem[] }) {
  if (items.length === 0) return <p className="mt-4">{t("mod.audit.empty")}</p>;
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            {(["time", "actor", "action", "entity", "details"] as const).map((c) => <th key={c} scope="col" className="p-2">{t(`mod.audit.col.${c}`)}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id} className="border-b border-border align-top">
              <td className="p-2 whitespace-nowrap"><time dateTime={a.createdAt}>{new Date(a.createdAt).toISOString().replace("T", " ").slice(0, 19)}</time></td>
              <td className="p-2">{a.actorType}{a.actorId ? ` · ${a.actorId}` : ""}</td>
              <td className="p-2">{a.action}</td>
              <td className="p-2 break-all">{a.entityType} {a.entityId}</td>
              <td className="p-2 break-all">{a.metadata ? JSON.stringify(a.metadata) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuditLog({ refreshKey }: { refreshKey: number }) {
  const [entity, setEntity] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: AuditItem[]; total: number; pageSize: number } | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    const qs = new URLSearchParams({ page: String(page), pageSize: "20", ...(applied ? { entityId: applied } : {}) });
    api<{ items: AuditItem[]; total: number; pageSize: number }>(`/api/admin/audit?${qs}`).then(setData, () => setFailed(true));
  }, [page, applied]);
  useEffect(load, [load, refreshKey]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <section aria-labelledby="audit-h">
      <h2 id="audit-h" className="text-lg font-semibold">{t("mod.audit.heading")}</h2>
      <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(entity.trim()); }}>
        <div>
          <label htmlFor="audit-entity" className="block text-sm font-medium">{t("mod.audit.entity")}</label>
          <input id="audit-entity" value={entity} maxLength={64} onChange={(e) => setEntity(e.target.value)} className="min-h-target rounded-md border border-border-strong bg-surface px-3" />
        </div>
        <button type="submit" className="min-h-target rounded-md bg-primary px-4 text-on-primary hover:bg-primary-hover">{t("mod.audit.apply")}</button>
      </form>
      {failed ? <p role="alert" className="mt-4">{t("mod.loadError")} <button type="button" className="text-link underline" onClick={load}>{t("mod.retry")}</button></p>
        : !data ? <p role="status" className="mt-4">{t("mod.loading")}</p> : <AuditTable items={data.items} />}
      {data && pages > 1 && (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="min-h-target rounded-md border border-border-strong px-3 disabled:opacity-60">{t("pagination.prev")}</button>
          <span>{t("mod.page", { page, pages })}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="min-h-target rounded-md border border-border-strong px-3 disabled:opacity-60">{t("pagination.next")}</button>
        </div>
      )}
    </section>
  );
}
