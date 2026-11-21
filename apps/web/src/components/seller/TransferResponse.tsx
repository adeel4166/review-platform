"use client";

import { useState } from "react";
import Link from "next/link";
import { t } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { StepUpFields, stepUp } from "../account/StepUpFields";
import { primaryBtn, secondaryBtn } from "./ui";

/** The target of an ownership change accepts (password + authenticator code step-up) or declines it. */
export function TransferResponse({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "busy" | "accepted" | "completed" | "declined" | "bad" | "no2fa">("idle");

  async function accept(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("busy");
    try {
      await stepUp(String(f.get("stepUpPassword") ?? ""), String(f.get("stepUpCode") ?? ""));
      const r = await api<{ status: string }>(`/api/ownership-transfers/${encodeURIComponent(id)}/accept`, { method: "POST", body: "{}" });
      setState(r.status === "COMPLETED" ? "completed" : "accepted");
    } catch (err) {
      setState(err instanceof ApiError && err.code === "TWO_FACTOR_REQUIRED" ? "no2fa" : "bad");
    }
  }
  async function decline() {
    setState("busy");
    try { await api(`/api/ownership-transfers/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }); setState("declined"); }
    catch { setState("bad"); }
  }

  if (state === "accepted" || state === "completed" || state === "declined") {
    return <p role="status" className="mt-6">{t(state === "accepted" ? "own.page.accepted" : state === "completed" ? "own.page.completed" : "own.page.declined")}</p>;
  }
  return (
    <div className="mt-6 max-w-md space-y-4">
      {state === "bad" && <p role="alert" className="rounded-md border border-danger bg-danger-bg p-3 text-danger">{t("own.page.err")}</p>}
      {state === "no2fa" && (
        <p role="alert" className="rounded-md border border-danger bg-danger-bg p-3 text-danger">{t("own.page.need2fa")}{" "}
          <Link className="underline" href="/account/security/2fa/setup">{t("own.page.setup2fa")}</Link></p>
      )}
      <form onSubmit={accept} className="space-y-3">
        <StepUpFields idPrefix="xfer" withCode />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={state === "busy"} className={primaryBtn}>{t("own.page.accept")}</button>
          <button type="button" disabled={state === "busy"} onClick={() => void decline()} className={secondaryBtn}>{t("own.page.decline")}</button>
        </div>
      </form>
    </div>
  );
}
