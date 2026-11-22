import type { ReactNode } from "react";
import { t } from "@/i18n/en";
import { Stars } from "./Stars";
import { VerifiedBadge } from "./VerifiedBadge";
import { ReviewVote, type VoteValue } from "./ReviewVote";
import { ReportDialog } from "./ReportDialog";

export interface PublicReview {
  id: string;
  rating: number;
  title: string;
  body: string;
  incentive?: string | null;
  verifiedBuyer?: boolean;
  /** Set only by a staff proof decision (ADR-0008); `verificationMethod` drives the label suffix. */
  verifiedPurchaseAt?: string | Date | null;
  verificationMethod?: string | null;
  editedAt?: string | Date | null;
  helpfulCount?: number;
  notHelpfulCount?: number;
  myVote?: VoteValue | null;
  publishedAt: string | Date | null;
  author: { handle: string; displayName: string };
  /** Published reply of the product's verified seller (server decides; never carries author identity). */
  reply?: { body: string; seller: { name: string; slug: string }; publishedAt: string | Date | null; editedAt: string | Date | null } | null;
  media: { id: string; width: number | null; height: number | null; thumbUrl: string; mediumUrl: string }[];
}

export interface ViewerCtx { signedIn: boolean; loginHref: string }

export function ReviewCard({ review: r, replyBox, ownBox, viewer }: { review: PublicReview; replyBox?: ReactNode; ownBox?: ReactNode; viewer?: ViewerCtx }) {
  const date = r.publishedAt ? new Date(r.publishedAt).toISOString().slice(0, 10) : null;
  return (
    <article className="rounded-lg border border-border bg-surface p-4" aria-labelledby={`rv-${r.id}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
        <span className="font-medium text-text">{r.author.displayName}</span>
        {(r.verifiedPurchaseAt || r.verifiedBuyer) && <VerifiedBadge method={r.verificationMethod} />}
        {date && <time dateTime={date}>{date}</time>}
        {r.editedAt && <span data-testid="edited-indicator">· {t("review.edited")}</span>}
      </div>
      <div className="mt-2"><Stars value={r.rating} /></div>
      <h3 id={`rv-${r.id}`} className="mt-1 text-lg font-semibold">{r.title}</h3>
      <p className="mt-2 whitespace-pre-line break-words">{r.body}</p>
      {r.incentive && r.incentive !== "NONE" && <p className="mt-2 text-sm text-text-muted">{t("review.incentive")}</p>}
      {r.media.length > 0 && (
        <ul aria-label={t("review.gallery")} className="mt-3 flex flex-wrap gap-2">
          {r.media.map((m, i) => (
            <li key={m.id}>
              {/* Opens the medium variant; signed URLs are short-lived, so no next/image optimisation. */}
              <a href={m.mediumUrl} target="_blank" rel="noopener noreferrer" className="block rounded-md focus-visible:outline">
                <img src={m.thumbUrl} alt={t("review.photoAlt", { n: i + 1, title: r.title })} loading="lazy" width={96} height={96} className="h-24 w-24 rounded-md object-cover" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {viewer && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <ReviewVote reviewId={r.id} helpful={r.helpfulCount ?? 0} notHelpful={r.notHelpfulCount ?? 0} myVote={r.myVote ?? null} signedIn={viewer.signedIn} loginHref={viewer.loginHref} />
          {!ownBox && <ReportDialog reviewId={r.id} reviewTitle={r.title} signedIn={viewer.signedIn} loginHref={viewer.loginHref} />}
        </div>
      )}
      {ownBox}
      {r.reply && (
        <section aria-label={t("reply.by", { seller: r.reply.seller.name })} className="mt-4 rounded-md border-l-4 border-primary bg-bg-subtle p-3" data-testid="public-reply">
          <p className="text-sm font-medium">{t("reply.by", { seller: r.reply.seller.name })}{r.reply.editedAt ? <span className="text-text-muted"> · {t("reply.edited")}</span> : null}</p>
          <p className="mt-1 whitespace-pre-line break-words">{r.reply.body}</p>
        </section>
      )}
      {replyBox}
    </article>
  );
}
