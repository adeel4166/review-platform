"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type MessageKey } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { field, primaryBtn, secondaryBtn } from "./ui";

export const REPLY_MAX = 1500;
export interface OwnReply { id: string; status: "PENDING" | "PUBLISHED" | "REJECTED" | "HIDDEN" | "REMOVED"; body: string }

/** Pure client-side check mirroring the first two server rules; the server (reply policy + moderation) stays authoritative. */
export function validateReply(body: string): "reply.err.short" | "reply.err.long" | null {
  const n = body.trim().length;
  return n === 0 ? "reply.err.short" : n > REPLY_MAX ? "reply.err.long" : null;
}

function errorKey(e: unknown): MessageKey {
  const code = e instanceof ApiError ? e.code : "";
  return code === "reply_policy_violation" ? "reply.err.policy" : code === "already_replied" ? "reply.err.exists"
    : code === "review_not_replyable" || code === "not_found" ? "reply.err.gone" : code === "rate_limited" ? "reply.err.rate"
    : code === "REPLY_RESTRICTED" ? "reply.err.restricted" : "reply.err.generic";
}

/**
 * Seller reply composer + own-reply state for one review (wireframe 04 §4.2). Shown only to seller members of a verified
 * seller; every rule is enforced again by the API. A new or edited reply is PENDING until moderation approves it.
 */
export function SellerReplyBox({ reviewId, reviewer, sellerName, initial }: { reviewId: string; reviewer: string; sellerName: string; initial: OwnReply | null }) {
  const router = useRouter();
  const [reply, setReply] = useState<OwnReply | null>(initial);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initial?.body ?? "");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const id = `reply-${reviewId}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const bad = validateReply(text);
    if (bad) { setError(t(bad)); return; }
    setBusy(true); setError(""); setMsg("");
    try {
      const r = reply
        ? await api<{ id: string; status: OwnReply["status"] }>(`/api/replies/${reply.id}`, { method: "PATCH", body: JSON.stringify({ body: text.trim() }) })
        : await api<{ id: string; status: OwnReply["status"] }>(`/api/reviews/${reviewId}/reply`, { method: "POST", body: JSON.stringify({ body: text.trim() }) });
      setReply({ id: r.id, status: r.status ?? "PENDING", body: text.trim() });
      setEditing(false);
      setMsg(t("reply.saved"));
      router.refresh();
    } catch (err) { setError(t(errorKey(err))); }
    setBusy(false);
  }

  async function remove() {
    if (!reply || !window.confirm(t("reply.delete.confirm"))) return;
    setBusy(true); setError(""); setMsg("");
    try {
      await api(`/api/replies/${reply.id}`, { method: "DELETE" });
      setReply(null); setText(""); setMsg(t("reply.deleted"));
      router.refresh();
    } catch (err) { setError(t(errorKey(err))); }
    setBusy(false);
  }

  const status = (reply?.status ?? "PENDING") as OwnReply["status"];
  return (
    <div className="mt-4 rounded-md border border-dashed border-border-strong p-3" data-testid="seller-reply-box">
      <p role="status" className="text-sm">{msg}</p>
      <p role="alert" className="text-danger">{error ? `⚠ ${error}` : ""}</p>

      {reply && !editing && (
        <div data-testid="own-reply">
          <p className="font-medium">{t("reply.heading")} · <span data-testid="reply-status">{t(`reply.status.${status}` as MessageKey)}</span></p>
          <p className="mt-1 whitespace-pre-line break-words">{reply.body}</p>
          <p className="mt-1 text-sm text-text-muted">{t(`reply.${status === "PENDING" ? "pending" : status === "PUBLISHED" ? "published" : status === "REMOVED" ? "removed" : "rejected"}.note` as MessageKey)}</p>
          {status !== "REMOVED" && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => setEditing(true)} disabled={busy} className={secondaryBtn}>{t("reply.edit")}</button>
              <button type="button" onClick={() => void remove()} disabled={busy} className={secondaryBtn}>{t("reply.delete")}</button>
            </div>
          )}
        </div>
      )}

      {!reply && !editing && <button type="button" onClick={() => { setEditing(true); setMsg(""); }} className={secondaryBtn} aria-label={`${t("reply.cta")}: ${reviewer}`}>{t("reply.cta")}</button>}

      {editing && (
        <form onSubmit={submit} noValidate aria-labelledby={`${id}-h`} className="space-y-3">
          <h4 id={`${id}-h`} className="font-semibold">{t("reply.composer.title", { name: reviewer })}</h4>
          <div>
            <label htmlFor={`${id}-body`} className="font-medium">{t("reply.composer.label")}</label>
            <p id={`${id}-hint`} className="text-sm text-text-muted">{t("reply.composer.guidance")}</p>
            <textarea id={`${id}-body`} rows={5} value={text} onChange={(e) => setText(e.target.value)} aria-describedby={`${id}-hint ${id}-count`} className={field} />
            <p id={`${id}-count`} className="text-sm text-text-muted">{t("reply.composer.count", { count: text.length })}</p>
          </div>
          <p className="text-sm">{t("reply.composer.as", { seller: sellerName })}</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={primaryBtn}>{busy ? t("reply.composer.saving") : t("reply.composer.submit")}</button>
            <button type="button" onClick={() => { setEditing(false); setError(""); setText(reply?.body ?? ""); }} className={secondaryBtn}>{t("reply.composer.cancel")}</button>
          </div>
        </form>
      )}
    </div>
  );
}
