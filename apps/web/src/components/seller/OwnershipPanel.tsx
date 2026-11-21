"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { t, type MessageKey } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { StepUpFields, stepUp } from "../account/StepUpFields";
import { field, formatDate, primaryBtn, secondaryBtn } from "./ui";
import type { TeamMember } from "./TeamPanel";

interface Transfer { id: string; kind: "ADD_OWNER" | "TRANSFER" | "REMOVE_OWNER"; status: string; initiatorId: string; targetUserId: string; executeAfter: string; acceptBy: string }
interface Ended { id: string; kind: Transfer["kind"]; status: string; targetUserId: string; endedAt: string | null }

/** "2d 4h 10m" from a millisecond span; the panel re-renders every 30 s, so seconds are not shown. */
export function formatRemaining(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d > 0 ? `${d}d ${h}h ${m % 60}m` : h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  const left = new Date(until).getTime() - now;
  // role=timer is not a live region: the value is read on demand, never announced every tick.
  return <span role="timer" data-testid="own-countdown">{left > 0 ? t("own.countdown", { time: formatRemaining(left) }) : t("own.countdown.now")}</span>;
}

/** Seller OWNER view of ownership changes (m3b-spec 3). Display gates only: the server enforces role, 2FA and step-up. */
export function OwnershipPanel({ sellerId, selfId, members }: { sellerId: string; selfId: string; members: TeamMember[] }) {
  const [open, setOpen] = useState<Transfer[] | null>(null);
  const [ended, setEnded] = useState<Ended[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<Transfer["kind"]>("ADD_OWNER");
  const name = (id: string) => members.find((m) => m.userId === id)?.displayName ?? "—";

  const load = useCallback(async () => {
    try {
      const r = await api<{ open: Transfer[]; ended: Ended[] }>(`/api/sellers/${sellerId}/ownership-transfers`);
      setOpen(r.open); setEnded(r.ended);
    } catch (e) {
      setOpen([]);
      if (e instanceof ApiError && e.code === "TWO_FACTOR_REQUIRED") setMsg({ ok: false, text: t("claim.error.2fa") });
    }
  }, [sellerId]);
  useEffect(() => { void load(); }, [load]);

  const targets = members.filter((m) => m.userId !== selfId && (kind === "REMOVE_OWNER" ? m.role === "OWNER" : m.role !== "OWNER"));

  async function request(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const targetUserId = String(f.get("target") ?? "");
    if (!targetUserId) return;
    setBusy(true); setMsg(null);
    try {
      await stepUp(String(f.get("stepUpPassword") ?? ""), String(f.get("stepUpCode") ?? ""));
      await api(`/api/sellers/${sellerId}/ownership-transfers`, { method: "POST", body: JSON.stringify({ kind, targetUserId }) });
      form.reset();
      setMsg({ ok: true, text: t("own.requested") });
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      setMsg({ ok: false, text: t(
        code === "target_two_factor_required" ? "own.err.2fa" : code === "transfer_open" ? "own.err.open" : code === "rate_limited" ? "own.err.rate"
        : code === "TWO_FACTOR_REQUIRED" ? "claim.error.2fa" : err instanceof ApiError && err.status === 401 ? "own.err.stepUp" : "own.err.generic") });
    }
    setBusy(false);
  }

  async function cancel(id: string) {
    setBusy(true); setMsg(null);
    try {
      await api(`/api/ownership-transfers/${id}/cancel`, { method: "POST", body: "{}" });
      setMsg({ ok: true, text: t("own.cancelled") });
      await load();
    } catch { setMsg({ ok: false, text: t("own.err.generic") }); }
    setBusy(false);
  }

  return (
    <section aria-labelledby="own-h" className="mt-8">
      <h2 id="own-h" className="text-xl font-semibold">{t("own.title")}</h2>
      <p className="text-sm text-text-muted">{t("own.lead")}</p>
      <p role={msg?.ok === false ? "alert" : "status"} className={`mt-2 ${msg?.ok === false ? "text-danger" : ""}`} data-testid="own-msg">
        {msg ? (msg.ok ? msg.text : `⚠ ${msg.text}`) : ""}
        {msg?.text === t("claim.error.2fa") && <> <Link className="text-link underline" href="/account/security/2fa/setup">{t("claim.error.2fa.link")}</Link></>}
      </p>

      <h3 className="mt-3 font-semibold">{t("own.open")}</h3>
      {open === null ? <p role="status">{t("mod.loading")}</p> : open.length === 0 ? <p>{t("own.none")}</p> : (
        <ul className="mt-2 space-y-3">
          {open.map((x) => (
            <li key={x.id} className="rounded-md border border-border p-3" data-testid="own-open">
              <p className="font-medium">{t(`own.kind.${x.kind}` as MessageKey)} · {name(x.targetUserId)}</p>
              <p className="text-sm">{t(`own.status.${x.status}` as MessageKey)}</p>
              <p className="text-sm text-text-muted"><Countdown until={x.executeAfter} />{x.status === "PENDING" && <> · {t("own.acceptBy", { date: formatDate(x.acceptBy) })}</>}</p>
              <button type="button" disabled={busy} onClick={() => void cancel(x.id)} className={`${secondaryBtn} mt-2`}
                aria-label={t("own.cancel.for", { kind: t(`own.kind.${x.kind}` as MessageKey), name: name(x.targetUserId) })}>{t("own.cancel")}</button>
            </li>
          ))}
        </ul>
      )}

      {open?.length === 0 && (
        <form onSubmit={request} className="mt-4 max-w-md space-y-3" aria-labelledby="own-req-h">
          <h3 id="own-req-h" className="font-semibold">{t("own.request")}</h3>
          <div>
            <label htmlFor="own-kind" className="font-medium">{t("own.kind")}</label>
            <select id="own-kind" value={kind} onChange={(e) => setKind(e.target.value as Transfer["kind"])} className={field}>
              {(["ADD_OWNER", "TRANSFER", "REMOVE_OWNER"] as const).map((k) => <option key={k} value={k}>{t(`own.kind.${k}` as MessageKey)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="own-target" className="font-medium">{t("own.target")}</label>
            <select id="own-target" name="target" required defaultValue="" className={field}>
              <option value="" disabled>{t("own.target.choose")}</option>
              {targets.map((m) => <option key={m.userId} value={m.userId}>{m.displayName} (@{m.handle})</option>)}
            </select>
          </div>
          <p className="text-sm">{t("own.stepUp")}</p>
          <StepUpFields idPrefix="own" withCode />
          <button type="submit" disabled={busy} className={primaryBtn}>{t("own.request")}</button>
        </form>
      )}

      {ended.length > 0 && (
        <>
          <h3 className="mt-6 font-semibold">{t("own.ended")}</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {ended.map((x) => <li key={x.id}>{t(`own.kind.${x.kind}` as MessageKey)} · {name(x.targetUserId)} · {t(`own.status.${x.status}` as MessageKey)}{x.endedAt ? ` · ${formatDate(x.endedAt)}` : ""}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}
