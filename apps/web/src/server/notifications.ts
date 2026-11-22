import { CHANNELS, NOTIFICATION_TYPES, assertPreferenceAllowed, MandatoryNotificationError, preferenceView, type Channel, type NotificationType, systemClock } from "@rp/core";
import { z } from "zod";
import type { Db } from "./db";
import { HttpError } from "./http";

export const listQuery = z.object({ cursor: z.string().max(64).optional(), unread: z.enum(["true", "false"]).optional() });
export const readInput = z.union([z.object({ ids: z.array(z.string().max(64)).min(1).max(100) }), z.object({ all: z.literal(true) })]);
export const prefInput = z.object({ type: z.enum(NOTIFICATION_TYPES), channel: z.enum(CHANNELS), enabled: z.boolean() });
const PAGE = 30;

/** DTO renders from `type` + `data` only; own rows only (recipientId scope). */
export async function listNotifications(db: Db, userId: string, q: z.infer<typeof listQuery>) {
  const rows = await db.notification.findMany({
    where: { recipientId: userId, ...(q.unread === "true" ? { readAt: null } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    select: { id: true, type: true, entityType: true, entityId: true, data: true, readAt: true, createdAt: true },
  });
  const unread = await db.notification.count({ where: { recipientId: userId, readAt: null } });
  return { items: rows.slice(0, PAGE), nextCursor: rows.length > PAGE ? rows[PAGE - 1]!.id : null, unread };
}
export async function markRead(db: Db, userId: string, input: z.infer<typeof readInput>, now = systemClock.now()) {
  const where = "all" in input ? { recipientId: userId, readAt: null } : { recipientId: userId, id: { in: input.ids }, readAt: null };
  return { updated: (await db.notification.updateMany({ where, data: { readAt: now } })).count };
}
export async function getPreferences(db: Db, userId: string) {
  return preferenceView(await db.notificationPreference.findMany({ where: { userId }, select: { type: true, channel: true, enabled: true } }));
}
/** Mandatory types are refused (422); the dispatcher also ignores a row for them (second enforcement, ADR-0031). */
export async function putPreference(db: Db, userId: string, input: z.infer<typeof prefInput>) {
  try { assertPreferenceAllowed(input.type as NotificationType); }
  catch (e) { if (e instanceof MandatoryNotificationError) throw new HttpError(422, "mandatory_notification", "This notification type cannot be disabled"); throw e; }
  await db.notificationPreference.upsert({
    where: { userId_type_channel: { userId, type: input.type, channel: input.channel as Channel } },
    create: { userId, type: input.type, channel: input.channel, enabled: input.enabled }, update: { enabled: input.enabled },
  });
  return { type: input.type, channel: input.channel, enabled: input.enabled, mandatory: false };
}
