"use client";

import { useEffect, useState } from "react";
import { t } from "@/i18n/en";
import { secondaryBtn } from "./ui";

export function EmailVerificationBanner() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/auth/verify-email/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { unverified: false }))
      .then((b: { unverified?: boolean }) => { if (live) setShow(b.unverified === true); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  async function resend() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/verify-email/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setMsg(res.ok ? { ok: true, text: t("ev.resent") } : { ok: false, text: t("ev.resendFailed") });
    } catch {
      setMsg({ ok: false, text: t("ev.resendFailed") });
    }
    setBusy(false);
  }
  if (!show) return null;
  return <EmailBannerView busy={busy} msg={msg} onResend={resend} />;
}

export function EmailBannerView({ busy, msg, onResend }: { busy: boolean; msg: { ok: boolean; text: string } | null; onResend: () => void }) {
  return (
    <section aria-label={t("verify.title")} className="border-b border-warning bg-warning-bg px-4 py-3" data-testid="email-banner">
      <div className="mx-auto flex max-w-content flex-wrap items-center gap-3">
        <p><span aria-hidden="true">⚠ </span>{t("ev.banner")}</p>
        <button type="button" onClick={onResend} disabled={busy} className={secondaryBtn}>{t("ev.resend")}</button>
        <p role="status" className="text-sm">{msg?.text ?? ""}</p>
      </div>
    </section>
  );
}
