"use client";

import { useState } from "react";
import { t, type MessageKey } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import dynamic from "next/dynamic";
import { field, primaryBtn, secondaryBtn } from "./seller/ui";

/** Radix dialog code is fetched on first open only (ADR-0034 D10 budget). */
const Dialog = dynamic(() => import("./Dialog").then((m) => m.Dialog), { ssr: false });

/** Mirrors REPORT_REASONS in @rp/core (kept local so the client bundle does not import server packages). */
export const REPORT_REASON_LIST = ["SPAM", "FAKE_OR_MISLEADING", "CONFLICT_OF_INTEREST", "OFF_TOPIC", "HARASSMENT_OR_HATE", "SEXUAL_CONTENT", "VIOLENCE_OR_THREATS", "PERSONAL_INFORMATION", "INTELLECTUAL_PROPERTY", "ILLEGAL_CONTENT", "IMPERSONATION", "OTHER"] as const;

function errKey(e: unknown): MessageKey {
  const code = e instanceof ApiError ? e.code : "";
  return code === "SELF_REPORT" ? "report.err.SELF_REPORT" : code === "EMAIL_NOT_VERIFIED" ? "report.err.EMAIL_NOT_VERIFIED"
    : code === "rate_limited" ? "report.err.rate_limited" : code === "not_found" ? "report.err.not_found" : "report.err.generic";
}

/** "Report" trigger + modal (wireframe 02): reason radio group, optional details (1000 chars), confirmation in a live region. */
export function ReportDialog({ reviewId, reviewTitle, signedIn, loginHref }: { reviewId: string; reviewTitle: string; signedIn: boolean; loginHref: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = `report-${reviewId}`;

  if (!signedIn) return <a href={loginHref} className="inline-flex min-h-target items-center text-sm text-link underline">{t("report.signin")}</a>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) { setErr(t("report.err.reason")); return; }
    setBusy(true); setErr("");
    try {
      await api(`/api/reviews/${reviewId}/reports`, { method: "POST", body: JSON.stringify({ reason, ...(details.trim() ? { details: details.trim() } : {}) }) });
      setDone(true);
    } catch (e2) { setErr(t(errKey(e2))); }
    setBusy(false);
  }
  function close() { setOpen(false); setDone(false); setReason(""); setDetails(""); setErr(""); }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={t("report.open.for", { title: reviewTitle })} className="inline-flex min-h-target items-center rounded-md px-2 text-sm text-link underline">
        <span aria-hidden="true">{t("report.open")}</span>
      </button>
      {open && (
        <Dialog titleId={`${id}-t`} title={t("report.title")} onClose={close}>
          {done ? (
            <>
              <p role="status" className="mt-3">{t("report.done")}</p>
              <div className="mt-4"><button type="button" data-autofocus className={primaryBtn} onClick={close}>{t("report.close")}</button></div>
            </>
          ) : (
            <form onSubmit={submit} noValidate aria-describedby={`${id}-intro`}>
              <p id={`${id}-intro`} className="mt-2 text-text-muted">{t("report.intro")}</p>
              <fieldset className="mt-4">
                <legend className="font-medium">{t("report.reason")}</legend>
                <div className="mt-2 grid gap-1">
                  {REPORT_REASON_LIST.map((r, i) => (
                    <label key={r} className="flex min-h-target items-center gap-2">
                      <input type="radio" name={`${id}-reason`} value={r} checked={reason === r} onChange={() => setReason(r)} data-autofocus={i === 0 ? "" : undefined} className="h-5 w-5" />
                      {t(`report.reason.${r}` as MessageKey)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label htmlFor={`${id}-d`} className="mt-4 block font-medium">{t("report.details")}</label>
              <p id={`${id}-dh`} className="text-sm text-text-muted">{t("report.details.hint")}</p>
              <textarea id={`${id}-d`} aria-describedby={`${id}-dh`} maxLength={1000} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} className={field} />
              <p role="alert" className="mt-2 text-danger">{err}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="submit" disabled={busy} className={primaryBtn}>{t("report.submit")}</button>
                <button type="button" onClick={close} className={secondaryBtn}>{t("report.cancel")}</button>
              </div>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}
