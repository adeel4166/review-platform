"use client";

import { useState } from "react";
import { t } from "@/i18n/en";
import { decide, type DecisionResult } from "@/lib/moderation-admin";

type Props = {
  caseId: string;
  /** Called after a successful decision (parent removes the case from the queue). */
  onDecided: (r: Extract<DecisionResult, { ok: true }>) => void;
  /** Called on 409/404 so the parent can refresh the queue. */
  onConflict?: () => void;
  /** Injectable for tests. */
  decideFn?: typeof decide;
};

const btn = "min-h-target rounded-md px-4 font-medium disabled:opacity-60";

export function DecisionPanel({ caseId, onDecided, onConflict, decideFn = decide }: Props) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "approve" | "reject") {
    setError(null);
    setBusy(true);
    const r = await decideFn(caseId, action, reason);
    setBusy(false);
    if (r.ok) return onDecided(r);
    setError(t(r.errorKey));
    if (r.errorKey === "mod.err.conflict") onConflict?.();
  }

  return (
    <fieldset className="mt-4 rounded-md border border-border p-3" disabled={busy}>
      <legend className="px-1 font-semibold">{t("mod.decision.legend")}</legend>
      <label htmlFor={`reason-${caseId}`} className="block text-sm font-medium">{t("mod.decision.reason")}</label>
      <textarea id={`reason-${caseId}`} value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)}
        aria-describedby={`reason-hint-${caseId}`} aria-invalid={error ? true : undefined}
        className="mt-1 block w-full rounded-md border border-border-strong bg-surface px-3 py-2" />
      <p id={`reason-hint-${caseId}`} className="mt-1 text-sm text-text-muted">{t("mod.decision.reasonHint")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" id="decision-approve" onClick={() => run("approve")} className={`${btn} bg-primary text-on-primary hover:bg-primary-hover`}>{t("mod.decision.approve")}</button>
        <button type="button" id="decision-reject" onClick={() => run("reject")} className={`${btn} border border-border-strong bg-surface`}>{t("mod.decision.reject")}</button>
      </div>
      <p role="alert" className="mt-2 text-sm">{error}</p>
      <p role="status" className="sr-only">{busy ? t("mod.decision.working") : ""}</p>
    </fieldset>
  );
}
