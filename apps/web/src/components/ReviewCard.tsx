import type { ReactNode } from "react";
import { t } from "@/i18n/en";
import { Stars } from "./Stars";
import { Avatar } from "./ui/Avatar";
import { VerifiedBadge } from "./VerifiedBadge";
import { ReviewVote, type VoteValue } from "./ReviewVote";
import { ReportDialog } from "./ReportDialog";

/** Only items already promoted to the public bucket reach this type; pending/rejected media never leave the server. */
export interface PublicMedia {
  id: string; width: number | null; height: number | null; thumbUrl: string; mediumUrl: string;
  kind?: "IMAGE" | "VIDEO"; videoUrl?: string | null; posterUrl?: string | null;
}

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
  media: PublicMedia[];
}

export interface ViewerCtx { signedIn: boolean; loginHref: string }

export function ReviewCard({ review: r, replyBox, ownBox, viewer }: { review: PublicReview; replyBox?: ReactNode; ownBox?: ReactNode; viewer?: ViewerCtx }) {
  const date = r.publishedAt ? new Date(r.publishedAt).toISOString().slice(0, 10) : null;
  return (
    <article className="rounded-lg border border-border bg-surface p-4 shadow-sm md:p-6" aria-labelledby={`rv-${r.id}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
        <Avatar name={r.author.displayName} size="sm" />
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
          {r.media.map((m, i) => m.kind === "VIDEO" && m.videoUrl ? (
            <li key={m.id} className="w-full max-w-md">
              {/* Transcoded MP4 rendition; no autoplay, controls are native (keyboard operable), metadata only until played. */}
              <video controls preload="none" playsInline poster={m.posterUrl ?? m.thumbUrl} aria-label={t("media.video.label", { n: i + 1, title: r.title })}
                width={m.width ?? undefined} height={m.height ?? undefined} className="h-auto w-full rounded-md bg-bg-subtle">
                <source src={m.videoUrl} type="video/mp4" />
                {t("media.video.fallback")}
              </video>
            </li>
          ) : (
            <li key={m.id}>
              {/* Responsive variants (256 w thumbnail, 1024 w medium); the link opens the medium rendition. Public CDN URLs, no signed GET. */}
              <a href={m.mediumUrl} target="_blank" rel="noopener noreferrer" className="block rounded-md focus-visible:outline">
                <img src={m.thumbUrl} srcSet={`${m.thumbUrl} 256w, ${m.mediumUrl} 1024w`} sizes="(min-width: 640px) 192px, 96px" alt={t("review.photoAlt", { n: i + 1, title: r.title })} loading="lazy" decoding="async" width={96} height={96} className="h-24 w-24 rounded-md object-cover sm:h-48 sm:w-48" />
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
