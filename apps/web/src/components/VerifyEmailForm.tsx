"use client";

import { useState } from "react";
import Link from "next/link";
import { t } from "@/i18n/en";

export function VerifyEmailForm({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "bad">("idle");
  async function confirm() {
    setState("busy");
    try {
      const res = await fetch("/api/auth/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      setState(res.ok ? "ok" : "bad");
    } catch {
      setState("bad");
    }
  }
  if (state === "ok") return <p role="status" className="mt-6">{t("verify.done")} <Link className="text-link underline" href="/login">{t("register.signIn")}</Link></p>;
  return (
    <div className="mt-6 space-y-4">
      {state === "bad" && <p role="alert" className="rounded-md border border-danger bg-danger-bg p-3 text-danger">{t("verify.invalid")}</p>}
      <button type="button" onClick={confirm} disabled={!token || state === "busy"}
        className="inline-flex min-h-target w-full items-center justify-center rounded-md bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover">
        {t("verify.confirm")}
      </button>
    </div>
  );
}
