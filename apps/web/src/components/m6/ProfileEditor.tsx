"use client";

import { useState } from "react";
import { t } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { field, primaryBtn } from "../seller/ui";

export const BIO_MAX = 300;
export function profileErrorKey(e: unknown) {
  const c = e instanceof ApiError ? e.code : "";
  return c === "handle_taken" ? "profile.err.taken" as const : c === "handle_change_limit" ? "profile.err.limit" as const : "profile.err.generic" as const;
}
export function ProfileEditor({ initial }: { initial: { handle: string; displayName: string; bio: string | null } }) {
  const [v, setV] = useState({ handle: initial.handle, displayName: initial.displayName, bio: initial.bio ?? "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try { await api("/api/me/profile", { method: "PATCH", body: JSON.stringify({ displayName: v.displayName, bio: v.bio.trim() === "" ? null : v.bio, ...(v.handle !== initial.handle ? { handle: v.handle } : {}) }) }); setMsg({ ok: true, text: t("profile.saved") }); }
    catch (e2) { setMsg({ ok: false, text: t(profileErrorKey(e2)) }); }
  }
  return (
    <form onSubmit={save} className="mt-4 max-w-xl space-y-3" noValidate>
      <p role={msg?.ok === false ? "alert" : "status"} className="min-h-[1.5rem]">{msg?.text ?? ""}</p>
      <div><label htmlFor="pe-name" className="font-medium">{t("profile.displayName")}</label><input id="pe-name" maxLength={64} value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} className={field} autoComplete="nickname" /></div>
      <div><label htmlFor="pe-handle" className="font-medium">{t("profile.handle")}</label><p id="pe-handle-h" className="text-sm text-text-muted">{t("profile.handle.hint")}</p><input id="pe-handle" aria-describedby="pe-handle-h" value={v.handle} onChange={(e) => setV({ ...v, handle: e.target.value })} className={field} autoComplete="username" /></div>
      <div><label htmlFor="pe-bio" className="font-medium">{t("profile.bio")}</label><textarea id="pe-bio" rows={4} maxLength={BIO_MAX} value={v.bio} onChange={(e) => setV({ ...v, bio: e.target.value })} className={field} /><p className="text-sm text-text-muted">{v.bio.length}/{BIO_MAX}</p></div>
      <button type="submit" className={primaryBtn}>{t("profile.save")}</button>
    </form>
  );
}
