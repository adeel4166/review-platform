/* eslint-disable @typescript-eslint/no-explicit-any */
import { NOTIFICATION_TYPES, dispatch, type Channel, type Clock, type NotificationPorts, type NotificationType } from "@rp/core";

/** Production notification dispatcher wiring (SEC-M7-01): outbox `notification.requested` -> dispatch() -> in-app row + email job. */
const TYPE_MAP: Record<string, NotificationType> = { CONTENT_PUBLISHED: "REVIEW_PUBLISHED" };
const known = new Set<string>(NOTIFICATION_TYPES);

export const prismaNotificationPorts = (db: any, enqueue: (name: string, data: unknown, opts: { jobId: string }) => Promise<unknown>): NotificationPorts => ({
  async disabled(recipientId, type) {
    const rows: { channel: Channel }[] = await db.notificationPreference.findMany({ where: { userId: recipientId, type, enabled: false }, select: { channel: true } });
    return new Set(rows.map((r) => r.channel));
  },
  async insertInApp(row) {
    try { await db.notification.create({ data: { ...row, data: row.data as never } }); return true; }
    catch (e) { if ((e as { code?: string }).code === "P2002") return false; throw e; }
  },
  async enqueueEmail(jobId, e) { await enqueue("notification.email", { userId: e.recipientId, type: e.type }, { jobId }); },
});

/** Resolves the recipient from server-side state only (the payload carries ids, never an address). Only REVIEW targets resolve a recipient (the author); seller-reply recipients are not derivable here, so they are skipped, not guessed. */
export async function handleNotificationRequested(db: any, ports: NotificationPorts, clock: Clock, eventId: string, p: { targetType?: string; targetId?: string; caseId?: string; type?: string }): Promise<"DELIVERED" | "DUPLICATE" | "SKIPPED"> {
  const type = TYPE_MAP[p.type ?? ""] ?? (p.type as NotificationType);
  if (!p.type || !known.has(type) || p.type === "REPORT_RESOLVED") return "SKIPPED"; // reporter recipients are not in this payload: never guess a recipient
  let recipientId: string | null = null;
  if (p.targetType === "REVIEW" && p.targetId) recipientId = (await db.review.findUnique({ where: { id: p.targetId }, select: { authorId: true } }))?.authorId ?? null;
  if (!recipientId) return "SKIPPED";
  const r = await dispatch(ports, { eventId, type, recipientId, entityType: p.targetType === "REVIEW" ? "Review" : "SellerReply", entityId: p.targetId ?? undefined, at: clock.now() });
  return r.duplicate ? "DUPLICATE" : "DELIVERED";
}
