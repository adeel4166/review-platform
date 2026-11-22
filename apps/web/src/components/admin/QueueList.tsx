import { t } from "@/i18n/en";
import { formatScore, holdText, type QueueItem } from "@/lib/moderation-admin";
import { VerifiedBadge } from "../VerifiedBadge";

export function QueueList({ items, selectedId, onOpen, now = Date.now() }: { items: QueueItem[]; selectedId?: string | null; onOpen: (id: string) => void; now?: number }) {
  if (items.length === 0) return <p className="mt-4">{t("mod.empty")}</p>;
  return (
    <ul className="mt-4 space-y-3">
      {items.map((c) => {
        const title = c.review ? c.review.title : t("mod.reply.item");
        const hold = holdText(c.holdExpiresAt, now);
        const text = c.review ? c.review.body : c.sellerReply?.body ?? "";
        return (
        <li key={c.id} data-case-id={c.id} className={`rounded-lg border bg-surface p-3 ${selectedId === c.id ? "border-primary" : "border-border"}`}>
          <h3 className="font-semibold">{title}</h3>
          <p className="line-clamp-2 text-sm text-text-muted">{text}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {c.review && <span>{t("mod.item.by", { handle: c.review.author.handle })}</span>}
            <span>{t("mod.item.score", { score: formatScore(c.aiScore) })}</span>
            {c.review && <span>{t("mod.item.media", { count: c.review._count?.media ?? 0 })}</span>}
            {c.review?.verifiedBuyer && <VerifiedBadge />}
            {hold && <span data-testid="hold-expiry" className={hold.expired ? "font-semibold text-danger" : ""}><span aria-hidden="true">⏱ </span>{hold.expired ? t("mod.item.holdExpired") : t("mod.item.holdExpires", { left: hold.left })}</span>}
          </p>
          <button type="button" onClick={() => onOpen(c.id)} aria-pressed={selectedId === c.id}
            className="mt-2 min-h-target rounded-md border border-border-strong bg-surface px-3">{t("mod.open")}<span className="sr-only">: {title}</span></button>
        </li>
        );
      })}
    </ul>
  );
}
