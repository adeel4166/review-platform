"use client";

import { useCallback, useEffect, useState } from "react";
import { en, t, type MessageKey } from "@/i18n/en";
import { api } from "@/lib/upload";
import { secondaryBtn } from "../seller/ui";

export interface Pref { type: string; channel: "IN_APP" | "EMAIL"; enabled: boolean; mandatory: boolean }
interface Notif { id: string; type: string; entityType: string | null; entityId: string | null; readAt: string | null; createdAt: string }
export const groupPrefs = (rows: Pref[]) => { const m = new Map<string, Pref[]>(); for (const r of rows) m.set(r.type, [...(m.get(r.type) ?? []), r]); return [...m.entries()]; };
/** Label for a notification type; an unknown type (e.g. added to the schema before a label) falls back to the raw type instead of throwing. */
export const typeLabel = (type: string): string => { const k = `notif.type.${type}`; return k in en ? t(k as MessageKey) : type; };
/** Where a notification leads (decision notice for moderation outcomes). */
export const notifHref = (n: { type: string; entityType: string | null; entityId: string | null }) => (n.entityType === "ModerationCase" && n.entityId ? `/decisions/${n.entityId}` : n.entityType === "Appeal" && n.entityId ? `/appeals/${n.entityId}` : null);

/** Inbox + preferences. Mandatory types (statements of reasons, security) are shown checked and locked; the server also refuses them (422). */
export function NotificationCenter() {
  const [prefs, setPrefs] = useState<Pref[] | null>(null);
  const [items, setItems] = useState<Notif[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => {
    api<{ items: Pref[] }>("/api/me/notification-preferences").then((r) => setPrefs(r.items), () => setPrefs([]));
    api<{ items: Notif[]; unread: number }>("/api/me/notifications").then((r) => { setItems(r.items); setUnread(r.unread); }, () => setItems([]));
  }, []);
  useEffect(load, [load]);

  async function toggle(p: Pref, enabled: boolean) {
    setPrefs((rows) => rows?.map((r) => (r.type === p.type && r.channel === p.channel ? { ...r, enabled } : r)) ?? null);
    try { await api("/api/me/notification-preferences", { method: "PUT", body: JSON.stringify({ type: p.type, channel: p.channel, enabled }) }); setMsg(t("notif.saved")); }
    catch { setMsg(t("notif.err")); load(); }
  }
  async function readAll() { await api("/api/me/notifications/read", { method: "POST", body: JSON.stringify({ all: true }) }).catch(() => undefined); load(); }

  return (
    <div>
      <section aria-labelledby="inbox-h" className="mt-4">
        <h2 id="inbox-h" className="text-xl font-semibold">{t("notif.inbox", { unread })}</h2>
        {unread > 0 && <button type="button" className={`${secondaryBtn} mt-2`} onClick={readAll}>{t("notif.readAll")}</button>}
        {!items ? <p role="status">{t("mod.loading")}</p> : items.length === 0 ? <p className="mt-2">{t("notif.empty")}</p> : (
          <ul className="mt-2 space-y-2">
            {items.map((n) => { const href = notifHref(n); return (
              <li key={n.id} className="rounded-md border border-border p-2" data-testid="notification">
                {!n.readAt && <strong>{t("notif.unread")} </strong>}{typeLabel(n.type)}
                {href && <> · <a className="text-link underline" href={href}>{t("notif.open")}</a></>}
              </li>); })}
          </ul>
        )}
      </section>
      <section aria-labelledby="prefs-h" className="mt-8">
        <h2 id="prefs-h" className="text-xl font-semibold">{t("notif.prefs")}</h2>
        <p className="mt-1 max-w-reading text-text-muted">{t("notif.mandatory.explain")}</p>
        <p role="status" className="min-h-[1.5rem]">{msg}</p>
        {!prefs ? <p role="status">{t("mod.loading")}</p> : (
          <div role="region" aria-label={t("notif.prefs")} tabIndex={0} className="overflow-x-auto">
            <table className="w-full text-left">
              <caption className="sr-only">{t("notif.prefs")}</caption>
              <thead><tr><th scope="col" className="p-2">{t("notif.col.type")}</th><th scope="col" className="p-2">{t("notif.col.IN_APP")}</th><th scope="col" className="p-2">{t("notif.col.EMAIL")}</th></tr></thead>
              <tbody>
                {groupPrefs(prefs).map(([type, rows]) => (
                  <tr key={type} className="border-t border-border">
                    <th scope="row" className="p-2 font-normal">{typeLabel(type)}{rows[0]?.mandatory && <span className="block text-sm text-text-muted">{t("notif.mandatory")}</span>}</th>
                    {rows.map((p) => (
                      <td key={p.channel} className="p-2">
                        <label className="inline-flex min-h-target items-center gap-2">
                          <input type="checkbox" className="h-5 w-5" checked={p.enabled} disabled={p.mandatory} aria-describedby={p.mandatory ? undefined : undefined} onChange={(e) => toggle(p, e.target.checked)} />
                          <span className="sr-only">{typeLabel(type)}: {t(`notif.col.${p.channel}` as MessageKey)}{p.mandatory ? ` (${t("notif.mandatory")})` : ""}</span>
                        </label>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
