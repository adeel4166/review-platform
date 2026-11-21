"use client";

import { useEffect, useState } from "react";
import { t } from "@/i18n/en";
import { formatScore, reasonList, type CaseDetail as Detail, type DecisionResult } from "@/lib/moderation-admin";
import { api } from "@/lib/upload";
import { Stars } from "../Stars";
import { VerifiedBadge } from "../VerifiedBadge";
import { DecisionPanel } from "./DecisionPanel";

export function CaseDetailView({ detail, onDecided, onConflict }: { detail: Detail; onDecided: (r: Extract<DecisionResult, { ok: true }>) => void; onConflict?: () => void }) {
  const reasons = reasonList(detail.aiReasons);
  const open = detail.state === "NEEDS_HUMAN";
  return (
    <section aria-labelledby={`detail-${detail.id}`} className="rounded-lg border border-border bg-surface p-4">
      <h2 id={`detail-${detail.id}`} className="text-lg font-semibold">{t("mod.detail.heading")}</h2>
      {detail.review ? (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <Stars value={detail.review.rating} />
            <span className="text-text-muted">{t("mod.item.by", { handle: detail.review.author.handle })}</span>
            {detail.review.verifiedBuyer && <VerifiedBadge />}
          </div>
          <h3 className="mt-2 font-semibold">{detail.review.title}</h3>
          <p className="mt-1 whitespace-pre-wrap break-words">{detail.review.body}</p>
        </>
      ) : (
        <>
          <h3 className="mt-2 font-semibold">{t("mod.reply.heading")}</h3>
          <p className="mt-1 whitespace-pre-wrap break-words" data-testid="mod-reply-body">{detail.sellerReply?.body ?? ""}</p>
        </>
      )}

      <h3 className="mt-4 font-semibold">{t("mod.detail.ai")}</h3>
      <p className="text-sm">{t("mod.item.score", { score: formatScore(detail.aiScore) })} · {t("mod.detail.confidence", { value: formatScore(detail.aiConfidence) })}
        {detail.aiProvider ? ` · ${t("mod.detail.provider", { name: detail.aiProvider })}` : ""}</p>
      <h4 className="mt-2 text-sm font-medium">{t("mod.detail.reasons")}</h4>
      {reasons.length ? <ul className="list-disc pl-5 text-sm">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul> : <p className="text-sm text-text-muted">{t("mod.detail.noReasons")}</p>}

      {detail.review && <h3 className="mt-4 font-semibold">{t("mod.detail.media")}</h3>}
      {detail.review && (detail.review.media.length === 0 ? <p className="text-sm text-text-muted">{t("mod.detail.noMedia")}</p> : (
        <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {detail.review.media.map((m, i) => (
            <li key={m.id} className="text-sm">
              {m.mediumUrl && m.thumbUrl ? (
                <a href={m.mediumUrl} target="_blank" rel="noopener noreferrer">
                  <img src={m.thumbUrl} alt={t("mod.detail.mediaAlt", { n: i + 1 })} width={m.width ?? undefined} height={m.height ?? undefined} loading="lazy" className="h-auto w-full rounded-md border border-border" />
                </a>
              ) : null}
              <p className="text-text-muted">{t("mod.detail.mediaStatus", { status: m.status })}</p>
            </li>
          ))}
        </ul>
      ))}

      {detail.decisionReason && <p className="mt-4 text-sm">{t("mod.detail.decided", { reason: detail.decisionReason })}</p>}
      {open && <DecisionPanel caseId={detail.id} onDecided={onDecided} onConflict={onConflict} />}
    </section>
  );
}

/** Loads one case (with signed media URLs) and renders it. */
export function CaseDetailLoader({ id, onDecided, onConflict, onClose }: { id: string; onDecided: (r: Extract<DecisionResult, { ok: true }>) => void; onConflict: () => void; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setDetail(null); setFailed(false);
    api<Detail>(`/api/admin/moderation/${encodeURIComponent(id)}`).then((d) => live && setDetail(d), () => live && setFailed(true));
    return () => { live = false; };
  }, [id]);
  return (
    <div>
      <button type="button" onClick={onClose} className="mb-2 min-h-target text-link underline">{t("mod.close")}</button>
      {failed ? <p role="alert">{t("mod.loadError")}</p> : !detail ? <p role="status">{t("mod.loading")}</p> : <CaseDetailView detail={detail} onDecided={onDecided} onConflict={onConflict} />}
    </div>
  );
}
