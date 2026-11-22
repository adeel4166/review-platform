"use client";

import { useState } from "react";
import { t, type MessageKey } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { CopyButton, field, formatDate, primaryBtn, secondaryBtn } from "./ui";

export type ClaimMethod = "DNS_TXT" | "META_TAG" | "BUSINESS_EMAIL_DOMAIN" | "DOCUMENT";
export interface ClaimView {
  id: string; method: string; status: string; domain: string | null; challengeExpiresAt: string | null; lastCheckOutcome: string | null;
  lastCheckAt: string | null; verifiedUntil: string | null;
}
interface Submitted extends ClaimView {
  instructions: { type: "TXT"; host: string; value: string } | { type: "META"; tag: string } | { type: "MARKETPLACE"; value: string } | null;
}
const METHODS: ClaimMethod[] = ["DNS_TXT", "META_TAG", "BUSINESS_EMAIL_DOMAIN", "DOCUMENT"];
const OPEN = ["PENDING", "CONTESTED"];

/**
 * Claim wizard. Verification state shown here is whatever the server last returned; this component never decides or
 * persists "verified" anywhere (the public badge is rendered by the server from the Seller row).
 */
export function ClaimWizard({ sellerId, initialClaims }: { sellerId: string; initialClaims: ClaimView[] }) {
  const [claims, setClaims] = useState<ClaimView[]>(initialClaims);
  const [instr, setInstr] = useState<Submitted["instructions"]>(null);
  const [method, setMethod] = useState<ClaimMethod>("DNS_TXT");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);

  const active = claims.find((c) => OPEN.includes(c.status)) ?? null;
  const latest = active ?? claims[0] ?? null;
  const isDoc = active?.method === "DOCUMENT";
  const isEmail = active?.method === "BUSINESS_EMAIL_DOMAIN";
  const step = !active ? (latest && !OPEN.includes(latest.status) ? 4 : 1) : isDoc ? 4 : isEmail ? 3 : instr && !active.lastCheckAt ? 2 : 3;
  const stepStatus = (n: number) => (n < step ? "done" : n === step ? "current" : "todo");

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      setClaims((await api<{ items: ClaimView[] }>(`/api/sellers/${sellerId}/claims`)).items);
    } catch {
      setError(t("claim.error.generic"));
    }
    setBusy(false);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const domain = String(fd.get("domain") ?? "").trim();
    const businessEmail = String(fd.get("businessEmail") ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = { scope: "SELLER", method };
      if (method === "BUSINESS_EMAIL_DOMAIN") body.businessEmail = businessEmail;
      else if (method !== "DOCUMENT") body.domain = domain;
      const r = await api<Submitted>(`/api/sellers/${sellerId}/claims`, { method: "POST", body: JSON.stringify(body) });
      setInstr(r.instructions);
      setEmailSentTo(method === "BUSINESS_EMAIL_DOMAIN" ? businessEmail : null);
      setClaims((cs) => [{ ...r, lastCheckOutcome: null, lastCheckAt: null, verifiedUntil: null }, ...cs]);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      setError(
        code === "domain_not_allowed" ? t("claim.error.domain")
        : code === "email_not_allowed" ? t("claim.error.email")
        : code === "TWO_FACTOR_REQUIRED" ? t("claim.error.2fa")
        : code === "claim_exists" ? t("claim.error.exists")
        : code === "rate_limited" ? t("claim.error.rate")
        : code === "email_unverified" || code === "EMAIL_NOT_VERIFIED" ? t("claim.error.verify")
        : t("claim.error.generic"),
      );
    }
    setBusy(false);
  }

  async function withdraw(id: string) {
    setBusy(true);
    try {
      await api(`/api/claims/${id}/withdraw`, { method: "POST" });
      setInstr(null);
      await refresh();
    } catch {
      setError(t("claim.error.generic"));
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="claim-h">
      <h2 id="claim-h" className="text-xl font-semibold">{t("claim.title")}</h2>
      <ol aria-label={t("claim.steps")} className="mt-3 grid gap-2 sm:grid-cols-4">
        {[1, 2, 3, 4].map((n) => (
          <li key={n} aria-current={stepStatus(n) === "current" ? "step" : undefined} className="rounded-md border border-border p-2">
            <span className="font-medium">{n}. {t(`claim.step.${n}` as MessageKey)}</span>
            <span className="block text-sm text-text-muted">{t(`claim.step.state.${stepStatus(n)}` as MessageKey)}</span>
          </li>
        ))}
      </ol>

      <p role="alert" className="mt-3 text-danger">{error ? `⚠ ${error}` : ""}</p>

      {!active && (
        <form onSubmit={submit} className="mt-4 max-w-lg space-y-4">
          <fieldset>
            <legend className="font-medium">{t("claim.method.legend")}</legend>
            {METHODS.map((m) => (
              <div key={m} className="mt-2 flex items-start gap-2">
                <input id={`m-${m}`} type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} className="mt-1 h-5 w-5" aria-describedby={`m-${m}-hint`} />
                <label htmlFor={`m-${m}`}>
                  <span className="font-medium">{t(`claim.method.${m}` as MessageKey)}</span>
                  <span id={`m-${m}-hint`} className="block text-sm text-text-muted">{t(`claim.method.${m}.hint` as MessageKey)}</span>
                </label>
              </div>
            ))}
          </fieldset>
          {method === "BUSINESS_EMAIL_DOMAIN" && (
            <div>
              <label htmlFor="claim-email" className="font-medium">{t("claim.businessEmail")} <span className="text-text-muted">({t("form.required")})</span></label>
              <p id="claim-email-hint" className="text-sm text-text-muted">{t("claim.businessEmail.hint")}</p>
              <input id="claim-email" name="businessEmail" type="email" required autoCapitalize="none" spellCheck={false} autoComplete="off" aria-describedby="claim-email-hint" className={field} />
            </div>
          )}
          {method !== "DOCUMENT" && method !== "BUSINESS_EMAIL_DOMAIN" && (
            <div>
              <label htmlFor="claim-domain" className="font-medium">{t("claim.domain")} <span className="text-text-muted">({t("form.required")})</span></label>
              <p id="claim-domain-hint" className="text-sm text-text-muted">{t("claim.domain.hint")}</p>
              <input id="claim-domain" name="domain" required autoCapitalize="none" spellCheck={false} autoComplete="off" aria-describedby="claim-domain-hint" className={field} />
            </div>
          )}
          <button type="submit" disabled={busy} className={primaryBtn}>{t("claim.start")}</button>
        </form>
      )}

      {isEmail && <p className="mt-4" role="status" data-testid="claim-email-note">{emailSentTo ? t("claim.email.sent", { email: emailSentTo }) : t("claim.email.sent", { email: active?.domain ?? "" })}</p>}
      {active && !isDoc && !isEmail && instr && <Instructions instr={instr} domain={active.domain} expires={active.challengeExpiresAt} />}
      {active && !isDoc && !isEmail && !instr && <p className="mt-4">{t("claim.instr.gone")}</p>}
      {isDoc && <p className="mt-4">{t("claim.doc.note")} {t("claim.doc.uploadSoon")}</p>}

      {latest && (
        <div className="mt-6 rounded-md border border-border p-3" aria-labelledby="status-h" role="group">
          <h3 id="status-h" className="font-semibold">{t("claim.status.title")}</h3>
          <p className="mt-1" data-testid="claim-status">{t(`claim.status.${latest.status}` as MessageKey)}</p>
          <p className="text-sm text-text-muted">
            {latest.status === "VERIFIED" && latest.verifiedUntil ? t("claim.status.note.VERIFIED", { date: formatDate(latest.verifiedUntil) })
              : ["PENDING", "REJECTED", "CONTESTED"].includes(latest.status) ? t(`claim.status.note.${latest.status}` as MessageKey)
              : t("claim.status.note.other")}
          </p>
          {!isDoc && !isEmail && latest.method !== "DOCUMENT" && latest.method !== "BUSINESS_EMAIL_DOMAIN" && (
            <p className="text-sm text-text-muted">{latest.lastCheckOutcome ? t("claim.lastCheck", { outcome: t(`claim.outcome.${latest.lastCheckOutcome}` as MessageKey) }) : t("claim.lastCheck.none")}</p>
          )}
          <p role="status" className="sr-only">{busy ? t("claim.checking") : ""}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={refresh} disabled={busy} className={secondaryBtn}>{busy ? t("claim.checking") : t("claim.check")}</button>
            {active && <button type="button" onClick={() => withdraw(active.id)} disabled={busy} className={secondaryBtn}>{t("claim.withdraw")}</button>}
          </div>
        </div>
      )}
    </section>
  );
}

function Instructions({ instr, domain, expires }: { instr: NonNullable<Submitted["instructions"]>; domain: string | null; expires: string | null }) {
  const rows: { label: string; value: string }[] =
    instr.type === "TXT" ? [{ label: t("claim.instr.type"), value: "TXT" }, { label: t("claim.instr.host"), value: instr.host }, { label: t("claim.instr.value"), value: instr.value }]
    : instr.type === "META" ? [{ label: t("claim.instr.tag"), value: instr.tag }]
    : [{ label: t("claim.instr.value"), value: instr.value }];
  return (
    <div className="mt-4" aria-labelledby="instr-h" role="group">
      <h3 id="instr-h" className="font-semibold">{t("claim.step.2")}</h3>
      <p>{instr.type === "TXT" ? t("claim.instr.dns") : t("claim.instr.meta", { domain: domain ?? "" })}</p>
      <dl className="mt-2 space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-center gap-2">
            <dt className="w-16 font-medium">{r.label}</dt>
            <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-2"><code className="break-all rounded-sm bg-bg-subtle px-2 py-1">{r.value}</code>
              {r.label !== t("claim.instr.type") && <CopyButton text={r.value} what={r.label} />}</dd>
          </div>
        ))}
      </dl>
      {expires && <p className="mt-2 text-sm text-text-muted">{t("claim.instr.expires", { date: formatDate(expires) })}</p>}
    </div>
  );
}
