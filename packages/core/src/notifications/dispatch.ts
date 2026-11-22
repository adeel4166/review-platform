import { CHANNELS, DAILY_GROUPED, isMandatory, NOTIFICATION_TYPES, type Channel, type NotificationType } from "./types";

export interface NotificationEvent { eventId: string; type: NotificationType; recipientId: string; actorId?: string | null; entityType?: string; entityId?: string; data?: Record<string, unknown>; at: Date }
export interface NotificationPorts {
  /** Disabled (type, channel) rows for the recipient. A missing row means enabled. */
  disabled(recipientId: string, type: NotificationType): Promise<ReadonlySet<Channel>>;
  /** Insert unique on (recipientId, groupKey); false when it already exists. */
  insertInApp(row: { recipientId: string; type: NotificationType; actorId: string | null; entityType: string | null; entityId: string | null; data: Record<string, unknown> | null; groupKey: string; createdAt: Date }): Promise<boolean>;
  /** Enqueue with the job id as the idempotency key. */
  enqueueEmail(jobId: string, e: NotificationEvent): Promise<void>;
  /** SEC-M7-02: e-mails already sent or queued for the recipient since `since` (optional: ports without it skip the cap). */
  recentEmails?(recipientId: string, since: Date): Promise<number>;
}
/** SEC-M7-02: non-mandatory types are capped per recipient; above the cap the in-app row is kept and the e-mail is dropped (digest). */
export const EMAIL_CAP = { perHour: 5 } as const;
/** Grouping key for e-mail only: NEW_FOLLOWER collapses per recipient and day, so N sock-puppet follows cost one e-mail, not N. */
export const emailJobKey = (e: NotificationEvent): string =>
  e.type === "NEW_FOLLOWER" ? `notif__NEW_FOLLOWER__${e.recipientId}__${e.at.toISOString().slice(0, 10)}` : `notif__${e.eventId}__${e.recipientId}`;
export const groupKeyOf = (e: NotificationEvent): string =>
  DAILY_GROUPED.has(e.type) ? `${e.type}:${e.entityId ?? "-"}:${e.at.toISOString().slice(0, 10)}` : `${e.type}:${e.eventId}`;
export interface DispatchResult { inApp: boolean; email: boolean; duplicate: boolean }

/** Skip a channel only if (type not mandatory AND preference disabled). A preference row for a mandatory type is ignored (NTF-001, TRS-009). */
export async function dispatch(p: NotificationPorts, e: NotificationEvent): Promise<DispatchResult> {
  const off = isMandatory(e.type) ? new Set<Channel>() : await p.disabled(e.recipientId, e.type);
  let inApp = false, email = false, duplicate = false;
  if (!off.has("IN_APP")) {
    inApp = await p.insertInApp({ recipientId: e.recipientId, type: e.type, actorId: e.actorId ?? null, entityType: e.entityType ?? null, entityId: e.entityId ?? null, data: e.data ?? null, groupKey: groupKeyOf(e), createdAt: e.at });
    duplicate = !inApp;
  }
  if (!off.has("EMAIL") && !duplicate) {
    const capped = !isMandatory(e.type) && !!p.recentEmails && (await p.recentEmails(e.recipientId, new Date(e.at.getTime() - 3_600_000))) >= EMAIL_CAP.perHour;
    if (!capped) { await p.enqueueEmail(emailJobKey(e), e); email = true; }
  }
  return { inApp, email, duplicate };
}

export interface PrefView { type: NotificationType; channel: Channel; enabled: boolean; mandatory: boolean }
export function preferenceView(rows: readonly { type: string; channel: string; enabled: boolean }[]): PrefView[] {
  const off = new Set(rows.filter((r) => !r.enabled).map((r) => `${r.type}:${r.channel}`));
  return NOTIFICATION_TYPES.flatMap((type) => CHANNELS.map((channel) => ({ type, channel, mandatory: isMandatory(type), enabled: isMandatory(type) || !off.has(`${type}:${channel}`) })));
}
export class MandatoryNotificationError extends Error { constructor() { super("mandatory_notification"); } }
/** Server-side refusal for PUT preferences (422 mandatory_notification). */
export function assertPreferenceAllowed(type: NotificationType): void { if (isMandatory(type)) throw new MandatoryNotificationError(); }
