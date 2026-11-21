"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { t, type MessageKey } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { QrCode } from "../QrCode";
import { CopyButton, field, primaryBtn, secondaryBtn } from "../seller/ui";
import { StepUpFields, stepUp } from "./StepUpFields";

type Phase = "intro" | "scan" | "confirm" | "codes" | "done";
const STEP_OF: Record<Phase, 1 | 2 | 3> = { intro: 1, scan: 1, confirm: 2, codes: 3, done: 3 };

/**
 * Enrolment wizard (wireframe 1.4). Secrets and recovery codes live only in component state: never in the URL, storage or logs.
 * Recovery codes are shown once; Finish stays disabled until the user ticks "I saved these".
 */
export function TwoFactorSetup({ initiallyEnabled, roleBanner }: { initiallyEnabled: boolean; roleBanner: boolean }) {
  const [phase, setPhase] = useState<Phase>(initiallyEnabled ? "done" : "intro");
  const [enrol, setEnrol] = useState<{ otpauthUri: string; secret: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [phase]);
  const step = STEP_OF[phase];

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const pw = String(new FormData(e.currentTarget).get("stepUpPassword") ?? "");
    setBusy(true); setError("");
    try {
      await stepUp(pw);
      setEnrol(await api<{ otpauthUri: string; secret: string }>("/api/account/2fa/totp/enrol", { method: "POST", body: "{}" }));
      setPhase("scan");
    } catch (err) {
      setError(t(err instanceof ApiError && err.status >= 400 && err.status < 500 && err.code !== "second_factor_pending" ? "tf.setup.err.stepUp" : "tf.setup.err.start"));
    }
    setBusy(false);
  }

  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s/g, "");
    setBusy(true); setError("");
    try {
      const r = await api<{ recoveryCodes: string[] | null }>("/api/account/2fa/totp/confirm", { method: "POST", body: JSON.stringify({ code }) });
      setEnrol(null); // the secret is no longer needed on screen
      setCodes(r.recoveryCodes ?? []);
      setPhase("codes");
    } catch {
      setError(t("tf.setup.err.code"));
    }
    setBusy(false);
  }

  const text = codes.join("\n") + "\n";
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = "recovery-codes.txt"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="print:text-black">
      {roleBanner && <p role="note" className="mt-4 rounded-md border border-border-strong bg-info-bg p-3 text-info">{t("tf.setup.banner")}</p>}
      <ol aria-label={t("tf.setup.steps")} className="mt-4 grid gap-2 sm:grid-cols-3 print:hidden">
        {([1, 2, 3] as const).map((n) => (
          <li key={n} aria-current={n === step && phase !== "done" ? "step" : undefined} className="rounded-md border border-border p-2">
            <span className="font-medium">{n}. {t(`tf.setup.step.${n}` as MessageKey)}</span>
            <span className="block text-sm text-text-muted">{t(`claim.step.state.${n < step || phase === "done" ? "done" : n === step ? "current" : "todo"}` as MessageKey)}</span>
          </li>
        ))}
      </ol>
      <p role="alert" className="mt-3 text-danger">{error ? `⚠ ${error}` : ""}</p>

      {phase === "intro" && (
        <form onSubmit={start} className="mt-4 max-w-md space-y-4">
          <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">{t("tf.setup.step.1")}</h2>
          <p>{t("tf.setup.stepUpNeeded")}</p>
          <StepUpFields idPrefix="setup" />
          <button type="submit" disabled={busy} className={primaryBtn}>{t("tf.setup.start")}</button>
        </form>
      )}

      {phase === "scan" && enrol && (
        <div className="mt-4 max-w-md space-y-4">
          <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">{t("tf.setup.step.1")}</h2>
          <p>{t("tf.setup.scan")}</p>
          <QrCode text={enrol.otpauthUri} alt={t("tf.setup.qrAlt")} />
          <p className="font-medium">{t("tf.setup.manual")}</p>
          <p className="flex flex-wrap items-center gap-2">
            <code data-testid="tf-secret" aria-label={t("tf.setup.key")} className="break-all rounded bg-bg-subtle px-2 py-1">{enrol.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
            <CopyButton text={enrol.secret} what={t("tf.setup.key")} />
          </p>
          <button type="button" onClick={() => setPhase("confirm")} className={primaryBtn}>{t("claim.start")}</button>
        </div>
      )}

      {phase === "confirm" && (
        <form onSubmit={confirm} className="mt-4 max-w-md space-y-4">
          <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">{t("tf.setup.step.2")}</h2>
          <p>{t("tf.setup.confirmLead")}</p>
          <div>
            <label htmlFor="setup-code" className="font-medium">{t("tf.code")}</label>
            <input id="setup-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className={field} />
          </div>
          <button type="submit" disabled={busy} className={primaryBtn}>{t("tf.setup.confirm")}</button>
        </form>
      )}

      {phase === "codes" && (
        <div className="mt-4 max-w-md space-y-4">
          <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">{t("tf.setup.step.3")}</h2>
          <p>{t("tf.setup.codesLead")}</p>
          <ul aria-label={t("tf.setup.codes")} data-testid="recovery-codes" className="grid grid-cols-2 gap-2 rounded-md border border-border bg-bg-subtle p-3 font-mono">
            {codes.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <div className="flex flex-wrap gap-2 print:hidden">
            <button type="button" onClick={download} className={secondaryBtn}>{t("tf.setup.download")}</button>
            <CopyButton text={text} what={t("tf.setup.codes")} />
            <button type="button" onClick={() => window.print()} className={secondaryBtn}>{t("tf.setup.print")}</button>
          </div>
          <div className="flex items-start gap-2 print:hidden">
            <input id="setup-saved" type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-1 h-5 w-5" />
            <label htmlFor="setup-saved" className="font-medium">{t("tf.setup.saved")}</label>
          </div>
          <button type="button" disabled={!saved} onClick={() => { setCodes([]); setPhase("done"); }} className={`${primaryBtn} print:hidden`}>{t("tf.setup.finish")}</button>
        </div>
      )}

      {phase === "done" && (
        <div className="mt-4 space-y-3" role="status">
          <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">{initiallyEnabled ? t("tf.setup.already") : t("tf.setup.done")}</h2>
          <Link href="/seller" className="inline-flex min-h-target items-center text-link underline">{t("seller.dash.manage")}</Link>
        </div>
      )}
    </div>
  );
}
