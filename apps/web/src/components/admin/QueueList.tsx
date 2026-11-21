import { t } from "@/i18n/en";
import { formatScore, type QueueItem } from "@/lib/moderation-admin";
import { VerifiedBadge } from "../VerifiedBadge";

export function QueueList({ items, selectedId, onOpen }: { items: QueueItem[]; selectedId?: string | null; onOpen: (id: string) => void }) {
  if (items.length === 0) return <p className="mt-4">{t("mod.empty")}</p>;
  return (
    <ul className="mt-4 space-y-3">
      {items.map((c) => (
        <li key={c.id} className={`rounded-lg border bg-surface p-3 ${selectedId === c.id ? "border-primary" : "border-border"}`}>
          <h3 className="font-semibold">{c.review.title}</h3>
          <p className="line-clamp-2 text-sm text-text-muted">{c.review.body}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span>{t("mod.item.by", { handle: c.review.author.handle })}</span>
            <span>{t("mod.item.score", { score: formatScore(c.aiScore) })}</span>
            <span>{t("mod.item.media", { count: c.review._count?.media ?? 0 })}</span>
            {c.review.verifiedBuyer && <VerifiedBadge />}
          </p>
          <button type="button" onClick={() => onOpen(c.id)} aria-pressed={selectedId === c.id}
            className="mt-2 min-h-target rounded-md border border-border-strong bg-surface px-3">{t("mod.open")}<span className="sr-only">: {c.review.title}</span></button>
        </li>
      ))}
    </ul>
  );
}
