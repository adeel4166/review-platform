import { t } from "@/i18n/en";
import { formatScore, holdText, type QueueItem } from "@/lib/moderation-admin";
import { VerifiedBadge } from "../VerifiedBadge";

/** Real table (caption, scoped headers); the open button sits in the first cell so the queue is keyboard-operable without row clicks. */
export function QueueList({ items, selectedId, onOpen, now = Date.now() }: { items: QueueItem[]; selectedId?: string | null; onOpen: (id: string) => void; now?: number }) {
  if (items.length === 0) return <p className="mt-4">{t("mod.empty")}</p>;
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface" role="region" aria-label={t("mod.queue.caption")} tabIndex={0}>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{t("mod.queue.caption")}</caption>
        <thead className="bg-bg-subtle"><tr>
          <th scope="col" className="px-3 py-2">{t("mod.queue.col.item")}</th>
          <th scope="col" className="px-3 py-2">{t("mod.queue.col.signals")}</th>
        </tr></thead>
        <tbody>
          {items.map((c) => {
            const title = c.review ? c.review.title : t("mod.reply.item");
            const hold = holdText(c.holdExpiresAt, now);
            const text = c.review ? c.review.body : c.sellerReply?.body ?? "";
            const selected = selectedId === c.id;
            return (
              <tr key={c.id} data-case-id={c.id} className={`border-t border-border align-top ${selected ? "bg-bg-subtle shadow-[inset_3px_0_0_var(--color-primary)]" : ""}`}>
                <th scope="row" className="px-3 py-2 font-normal">
                  <button type="button" onClick={() => onOpen(c.id)} aria-pressed={selected}
                    className="min-h-target text-left font-semibold text-link underline">{title}<span className="sr-only"> — {t("mod.open")}</span></button>
                  <span className="line-clamp-2 block text-text-muted">{text}</span>
                </th>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {c.review && <span>{t("mod.item.by", { handle: c.review.author.handle })}</span>}
                    <span>{t("mod.item.score", { score: formatScore(c.aiScore) })}</span>
                    {c.review && <span>{t("mod.item.media", { count: c.review._count?.media ?? 0 })}</span>}
                    {c.review?.verifiedBuyer && <VerifiedBadge />}
                    {hold && <span data-testid="hold-expiry" className={hold.expired ? "font-semibold text-danger" : ""}><span aria-hidden="true">⏱ </span>{hold.expired ? t("mod.item.holdExpired") : t("mod.item.holdExpires", { left: hold.left })}</span>}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
