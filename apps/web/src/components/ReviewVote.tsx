"use client";

import { useState } from "react";
import { t, type MessageKey } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";

export type VoteValue = "HELPFUL" | "NOT_HELPFUL";
interface VoteResult { value: VoteValue | null; helpfulCount: number; notHelpfulCount: number }

const btn = "inline-flex min-h-target min-w-target items-center justify-center gap-1 rounded-md border border-border-strong bg-surface px-3 font-medium aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-on-primary disabled:opacity-60";

export function voteErrorKey(e: unknown): MessageKey {
  const code = e instanceof ApiError ? e.code : "";
  return (["SELF_VOTE", "CONFLICT_OF_INTEREST", "VOTING_RESTRICTED", "EMAIL_NOT_VERIFIED"].includes(code) ? `vote.err.${code}` : code === "rate_limited" ? "vote.err.rate_limited" : "vote.err.generic") as MessageKey;
}

/**
 * Helpful / not helpful toggle buttons (aria-pressed) with counts. Pressing the active button retracts the vote.
 * `signedIn=false` renders a sign-in link instead of buttons. The API enforces every rule again.
 */
export function ReviewVote({ reviewId, helpful, notHelpful, myVote, signedIn, loginHref }: { reviewId: string; helpful: number; notHelpful: number; myVote: VoteValue | null; signedIn: boolean; loginHref: string }) {
  const [s, setS] = useState<VoteResult>({ value: myVote, helpfulCount: helpful, notHelpfulCount: notHelpful });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function press(v: VoteValue) {
    setBusy(true); setErr("");
    try {
      setS(await api<VoteResult>(`/api/reviews/${reviewId}/vote`, s.value === v ? { method: "DELETE" } : { method: "PUT", body: JSON.stringify({ value: v }) }));
    } catch (e) { setErr(t(voteErrorKey(e))); }
    setBusy(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("vote.group")} data-testid="review-vote">
      <span className="text-sm text-text-muted">{t("vote.question")}</span>
      {signedIn ? (
        <>
          <button type="button" aria-pressed={s.value === "HELPFUL"} disabled={busy} onClick={() => press("HELPFUL")} className={btn} aria-label={t("vote.yes.label", { count: s.helpfulCount })}>
            <span aria-hidden="true">{t("vote.yes")} {s.helpfulCount}</span>
          </button>
          <button type="button" aria-pressed={s.value === "NOT_HELPFUL"} disabled={busy} onClick={() => press("NOT_HELPFUL")} className={btn} aria-label={t("vote.no.label", { count: s.notHelpfulCount })}>
            <span aria-hidden="true">{t("vote.no")} {s.notHelpfulCount}</span>
          </button>
        </>
      ) : (
        <>
          <span className="text-sm">{t("vote.yes")} {s.helpfulCount} · {t("vote.no")} {s.notHelpfulCount}</span>
          <a href={loginHref} className="text-sm text-link underline">{t("vote.signin")}</a>
        </>
      )}
      <p role="status" className="sr-only">{t("vote.status", { helpful: s.helpfulCount, notHelpful: s.notHelpfulCount })}</p>
      <p role="alert" className="w-full text-sm text-danger">{err}</p>
    </div>
  );
}
