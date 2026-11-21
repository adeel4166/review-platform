"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { t } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { field, primaryBtn } from "../seller/ui";

const WINDOW_SECONDS = 10 * 60; // the pending session lives 10 minutes (ADR-0002)
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Second step of sign-in (wireframe 1.3). One input, no auto-submit. The countdown is announced only at 2:00 and 0:30
 * (role=timer is not a live region by default; the separate status text carries the two announcements).
 */
export function TwoFactorChallenge({ callbackUrl }: { callbackUrl: string }) {
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(WINDOW_SECONDS);
  const [announce, setAnnounce] = useState("");
  const [ended, setEnded] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, [mode]);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => {
      const s = Math.max(0, WINDOW_SECONDS - Math.floor((Date.now() - started) / 1000));
      setLeft(s);
      if (s === 120 || s === 30) setAnnounce(t("tf.challenge.timer", { time: fmt(s) }));
      if (s === 0) { setEnded(true); setAnnounce(t("tf.challenge.expired")); clearInterval(id); }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    if (!code) return;
    setBusy(true); setError("");
    try {
      await api(mode === "totp" ? "/api/auth/2fa/verify" : "/api/auth/2fa/recovery", { method: "POST", body: JSON.stringify({ code }) });
      window.location.assign(callbackUrl); // full load so the upgraded session cookie is used
      return;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { setEnded(true); setError(t("tf.challenge.expired")); }
      else if (err instanceof ApiError && err.status === 429) setError(t("tf.challenge.err.throttled"));
      else if (err instanceof ApiError && (err.status === 400 || err.status === 403)) setError(t(mode === "totp" ? "tf.challenge.err.code" : "tf.challenge.err.recovery"));
      else setError(t("tf.challenge.err.generic"));
    }
    setBusy(false);
    input.current?.focus();
  }

  async function cancel() {
    try {
      const { csrfToken } = (await (await fetch("/api/auth/csrf")).json()) as { csrfToken: string };
      await fetch("/api/auth/signout", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken, json: "true" }) });
    } catch { /* the login page works either way */ }
    window.location.assign("/login");
  }

  const recovery = mode === "recovery";
  return (
    <div className="mt-4">
      <p>{recovery ? t("tf.challenge.recoveryLead") : t("tf.challenge.lead")}</p>
      <p role="alert" className="mt-3 text-danger">{error ? `⚠ ${error}` : ""}</p>
      {ended ? (
        <p className="mt-3"><Link href="/login" className="text-link underline">{t("tf.challenge.cancel")}</Link></p>
      ) : (
        <form onSubmit={submit} noValidate aria-busy={busy} className="mt-3 space-y-4">
          <div>
            <label htmlFor="tf-code" className="font-medium">{recovery ? t("tf.challenge.recoveryCode") : t("tf.code")}</label>
            {recovery && <p id="tf-hint" className="text-sm text-text-muted">{t("tf.challenge.recoveryHint")}</p>}
            <input ref={input} id="tf-code" name="code" autoComplete={recovery ? "off" : "one-time-code"} inputMode={recovery ? "text" : "numeric"}
              autoCapitalize="none" spellCheck={false} aria-describedby={recovery ? "tf-hint" : undefined} className={field} />
          </div>
          <button type="submit" aria-disabled={busy} className={`${primaryBtn} w-full`}>{busy ? t("tf.challenge.verifying") : t("tf.challenge.verify")}</button>
          <p><button type="button" onClick={() => { setMode(recovery ? "totp" : "recovery"); setError(""); }} className="min-h-target text-link underline">
            {recovery ? t("tf.challenge.useApp") : t("tf.challenge.useRecovery")}</button></p>
        </form>
      )}
      <p role="timer" aria-label={t("tf.challenge.timer", { time: fmt(left) })} className="mt-4 text-sm text-text-muted">⏱ {t("tf.challenge.timer", { time: fmt(left) })}</p>
      <p role="status" className="sr-only">{announce}</p>
      <p className="mt-2"><button type="button" onClick={cancel} className="min-h-target text-link underline">{t("tf.challenge.cancel")}</button></p>
    </div>
  );
}
