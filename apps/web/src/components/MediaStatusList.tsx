"use client";

import { useEffect, useState } from "react";
import { t } from "@/i18n/en";
import { rejectionKey } from "@/lib/review-form";
import { api } from "@/lib/upload";

export interface OwnMediaItem { id: string; status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED"; failureReason: string | null; kind?: "IMAGE" | "VIDEO" }

/** Pure: label for one item's state (also used by tests). */
export function mediaStateText(i: Pick<OwnMediaItem, "status" | "failureReason">): { text: string; tone: "info" | "ok" | "error" } {
  if (i.status === "FAILED") return { text: t("media.state.rejected", { message: t(rejectionKey(i.failureReason)) }), tone: "error" };
  if (i.status === "READY") return { text: t("media.state.ready"), tone: "ok" };
  if (i.status === "UPLOADING") return { text: t("media.state.pending"), tone: "info" };
  return { text: t("media.state.processing"), tone: "info" };
}

export const isTerminal = (i: Pick<OwnMediaItem, "status">) => i.status === "READY" || i.status === "FAILED";

/**
 * The author's view of a review's media: processing, ready or rejected (with a plain-language reason and a next step).
 * Polls the owner-only endpoint until every item is terminal. Never shows file bytes or threat names.
 */
export function MediaStatusList({ reviewId, pollMs = 3000, initial, level = 3 }: { reviewId: string; pollMs?: number; initial?: OwnMediaItem[]; level?: 3 | 4 | 5 }) {
  const [items, setItems] = useState<OwnMediaItem[] | null>(initial ?? null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await api<{ items: OwnMediaItem[] }>(`/api/reviews/${encodeURIComponent(reviewId)}/media`);
        if (!live) return;
        setItems(r.items);
        if (r.items.some((i) => !isTerminal(i))) timer = setTimeout(tick, pollMs);
      } catch {
        if (live) timer = setTimeout(tick, pollMs * 2);
      }
    };
    void tick();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [reviewId, pollMs]);

  if (!items || items.length === 0) return null;
  const H = `h${level}` as "h3" | "h4" | "h5";
  let photo = 0, video = 0;
  return (
    <section aria-labelledby={`ms-${reviewId}`} className="mt-4" data-testid="media-status">
      <H id={`ms-${reviewId}`} className="font-medium">{t("form.media.status.heading")}</H>
      <p className="text-sm text-text-muted">{t("form.media.status.hint")}</p>
      <ul className="mt-2 grid gap-2">
        {items.map((i) => {
          const label = i.kind === "VIDEO" ? t("media.state.video", { n: ++video }) : t("media.state.photo", { n: ++photo });
          const s = mediaStateText(i);
          return (
            <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2" data-status={i.status}>
              <span className="font-medium">{label}</span>
              {/* Status is text, never colour alone (WCAG 1.4.1); polite live region so progress is announced (4.1.3). */}
              <span role={s.tone === "error" ? "alert" : "status"} className={s.tone === "error" ? "text-danger" : "text-text-muted"}>{s.text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
