"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type MessageKey } from "@/i18n/en";
import { api } from "@/lib/upload";
import { field, formatDate, primaryBtn, secondaryBtn } from "./ui";

export interface TeamMember { userId: string; role: "OWNER" | "MANAGER" | "RESPONDER"; handle: string; displayName: string }
export interface TeamInvitation { id: string; email: string; role: string; expiresAt: string }
interface Props {
  sellerId: string; members: TeamMember[]; invitations: TeamInvitation[];
  /** Display-only gates. The server enforces every one of these again (AZ-007/AZ-010). */
  canInvite: boolean; canRemove: boolean; selfId: string;
}

export function TeamPanel({ sellerId, members, invitations, canInvite, canRemove, selfId }: Props) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: okText });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: t("team.invite.error") });
    }
    setBusy(false);
  }

  function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    void run(async () => {
      await api(`/api/sellers/${sellerId}/invitations`, { method: "POST", body: JSON.stringify({ email: String(f.get("email") ?? ""), role: String(f.get("role") ?? "RESPONDER") }) });
      form.reset();
    }, t("team.invite.sent"));
  }

  return (
    <section aria-labelledby="team-h" className="mt-8">
      <h2 id="team-h" className="text-xl font-semibold">{t("team.title")}</h2>
      <p className="text-sm text-text-muted">{t("team.2fa")}</p>
      <p role={msg?.ok === false ? "alert" : "status"} className={`mt-2 ${msg?.ok === false ? "text-danger" : ""}`}>{msg?.text ?? ""}</p>

      <div className="mt-3 overflow-x-auto" role="region" aria-labelledby="members-h" tabIndex={0}>
        <h3 id="members-h" className="font-semibold">{t("team.members")}</h3>
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">{t("team.members")}</caption>
          <thead><tr>
            <th scope="col" className="py-1 pr-4">{t("team.col.member")}</th>
            <th scope="col" className="py-1 pr-4">{t("team.col.role")}</th>
            {canRemove && <th scope="col" className="py-1">{t("team.col.actions")}</th>}
          </tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-t border-border">
                <th scope="row" className="py-2 pr-4 font-normal">{m.displayName} <span className="text-text-muted">@{m.handle}</span></th>
                <td className="py-2 pr-4">{t(`role.${m.role}` as MessageKey)}</td>
                {canRemove && (
                  <td className="py-2">
                    {m.role !== "OWNER" && m.userId !== selfId && (
                      <button type="button" disabled={busy} className={secondaryBtn} aria-label={t("team.remove.for", { name: m.displayName })}
                        onClick={() => { if (window.confirm(t("team.removeConfirm", { name: m.displayName }))) void run(() => api(`/api/sellers/${sellerId}/members/${m.userId}`, { method: "DELETE" }), t("team.remove")); }}>
                        {t("team.remove")}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canInvite && (
        <>
          <h3 className="mt-6 font-semibold">{t("team.invitations")}</h3>
          {invitations.length === 0 ? <p className="mt-1">{t("team.invitations.none")}</p> : (
            <ul className="mt-2 space-y-2">
              {invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3">
                  <span>{i.email} · {t(`role.${i.role}` as MessageKey)} · {t("team.invitation.expires", { date: formatDate(i.expiresAt) })}</span>
                  <button type="button" disabled={busy} className={secondaryBtn} aria-label={t("team.revoke.for", { email: i.email })}
                    onClick={() => void run(() => api(`/api/invitations/${i.id}`, { method: "DELETE" }), t("team.revoke"))}>{t("team.revoke")}</button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={invite} className="mt-4 max-w-md space-y-3" aria-labelledby="invite-h">
            <h3 id="invite-h" className="font-semibold">{t("team.invite.title")}</h3>
            <div>
              <label htmlFor="invite-email" className="font-medium">{t("team.invite.email")}</label>
              <input id="invite-email" name="email" type="email" required autoComplete="off" className={field} />
            </div>
            <div>
              <label htmlFor="invite-role" className="font-medium">{t("team.invite.role")}</label>
              <select id="invite-role" name="role" className={field} defaultValue="RESPONDER">
                <option value="RESPONDER">{t("team.invite.role.RESPONDER")}</option>
                <option value="MANAGER">{t("team.invite.role.MANAGER")}</option>
              </select>
            </div>
            <button type="submit" disabled={busy} className={primaryBtn}>{t("team.invite.submit")}</button>
          </form>
        </>
      )}
    </section>
  );
}
