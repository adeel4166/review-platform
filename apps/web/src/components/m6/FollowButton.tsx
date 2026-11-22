"use client";

import { useState } from "react";
import { t } from "@/i18n/en";
import { api } from "@/lib/upload";
import { secondaryBtn } from "../seller/ui";

/** Follow/unfollow a user. `followId` is the Follow row id when already following (DELETE /api/follows/:id). */
export function FollowButton({ userId, handle, followId: initial }: { userId: string; handle: string; followId: string | null }) {
  const [followId, setFollowId] = useState(initial);
  const [msg, setMsg] = useState("");
  async function toggle() {
    setMsg("");
    try {
      if (followId) { await api(`/api/follows/${followId}`, { method: "DELETE" }).catch(() => undefined); setFollowId(null); setMsg(t("follow.stopped", { handle })); }
      else { const r = await api<{ id?: string }>("/api/follows", { method: "PUT", body: JSON.stringify({ targetType: "USER", targetId: userId }) }); setFollowId(r.id ?? "following"); setMsg(t("follow.started", { handle })); }
    } catch { setMsg(t("follow.err")); }
  }
  return (<><button type="button" aria-pressed={!!followId} onClick={toggle} className={secondaryBtn}>{followId ? t("follow.following") : t("follow.follow")}<span className="sr-only"> @{handle}</span></button><p role="status" className="text-sm">{msg}</p></>);
}
