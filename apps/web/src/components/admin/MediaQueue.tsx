"use client";

import { useCallback, useEffect, useState } from "react";
import { t, type MessageKey } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { rejectionKey } from "@/lib/review-form";
import { secondaryBtn } from "../seller/ui";

export interface QueueMedia { id: string; reviewId: string; kind: "IMAGE" | "VIDEO"; failureReason: string | null; createdAt: string; retryable: boolean }

export function mediaAdminErrorKey(e: unknown): MessageKey {
  const code = e instanceof ApiError ? e.code : "";
  return code === "invalid_transition" || code === "not_retryable" || code === "not_found" ? "admin.media.err.state" : "admin.media.err.generic";
}

export function reasonText(reason: string | null): string {
  if (reason === "MALWARE") return t("admin.media.reason.MALWARE");
  if (reason === "BANNED_HASH") return t("admin.media.reason.BANNED_HASH");
  return t(rejectionKey(reason));
}

/** Staff-only list of failed/quarantined media. Metadata only: previews are never rendered. Authorisation is enforced by the API. */
export function MediaQueue() {
  const [items, setItems] = useState<QueueMedia[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(null); setFailed(false);
    try { setItems((await api<{ items: QueueMedia[] }>("/api/admin/media?pageSize=50")).items); } catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function decide(m: QueueMedia, decision: "approve" | "reject") {
    setBusy(m.id); setMsg(null);
    try {
      await api(`/api/admin/media/${encodeURIComponent(m.id)}/decide`, { method: "POST", body: JSON.stringify({ decision }) });
      setItems((xs) => (xs ?? []).filter((x) => x.id !== m.id));
      setMsg({ ok: true, text: t(decision === "approve" ? "admin.media.done.approve" : "admin.media.done.reject", { id: m.id }) });
    } catch (e) {
      setMsg({ ok: false, text: t(mediaAdminErrorKey(e)) });
    } finally { setBusy(null); }
  }

  return (
    <section aria-labelledby="media-h">
      <h1 id="media-h" className="text-2xl font-semibold">{t("admin.media.title")}</h1>
      <p className="mt-2 max-w-reading text-text-muted">{t("admin.media.intro")}</p>
      <p role={msg?.ok === false ? "alert" : "status"} className={`mt-3 ${msg?.ok === false ? "text-danger" : ""}`}>{msg?.text ?? ""}</p>
      <div aria-busy={items === null && !failed} className="mt-3">
        {failed ? (
          <p role="alert">{t("admin.media.error")} <button type="button" className={secondaryBtn} onClick={load}>{t("admin.media.retry")}</button></p>
        ) : items === null ? <p>{t("admin.media.loading")}</p>
        : items.length === 0 ? <p>{t("admin.media.empty")}</p> : (
          <div className="overflow-x-auto" role="region" aria-label={t("admin.media.caption")} tabIndex={0}>
            <table className="w-full text-left">
              <caption className="sr-only">{t("admin.media.caption")}</caption>
              <thead><tr>
                <th scope="col" className="p-2">{t("admin.media.col.file")}</th>
                <th scope="col" className="p-2">{t("admin.media.col.kind")}</th>
                <th scope="col" className="p-2">{t("admin.media.col.reason")}</th>
                <th scope="col" className="p-2">{t("admin.media.col.date")}</th>
                <th scope="col" className="p-2">{t("admin.media.col.actions")}</th>
              </tr></thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id} className="border-t border-border">
                    <th scope="row" className="p-2 font-mono text-sm font-normal">{m.id}</th>
                    <td className="p-2">{m.kind === "VIDEO" ? "Video" : "Photo"}</td>
                    <td className="p-2">{reasonText(m.failureReason)}</td>
                    <td className="p-2"><time dateTime={m.createdAt}>{m.createdAt.slice(0, 10)}</time></td>
                    <td className="flex flex-wrap gap-2 p-2">
                      {m.retryable && <button type="button" disabled={busy === m.id} className={secondaryBtn} aria-label={t("admin.media.approve.for", { id: m.id })} onClick={() => void decide(m, "approve")}>{t("admin.media.approve")}</button>}
                      <button type="button" disabled={busy === m.id} className={secondaryBtn} aria-label={t("admin.media.reject.for", { id: m.id })} onClick={() => void decide(m, "reject")}>{t("admin.media.reject")}</button>
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
