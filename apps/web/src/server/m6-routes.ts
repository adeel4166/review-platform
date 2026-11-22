import { systemClock, type StaffRole } from "@rp/core";
import { db } from "./db";
import type { Actor } from "./session";
import type { Staff } from "./approvals";
import { HttpError } from "./http";

/** Maps the session role to staff roles for the four-eyes service (ADMIN is a subset of SUPER_ADMIN). */
export const STAFF_ROLES: Record<string, StaffRole[]> = {
  super_admin: ["SUPER_ADMIN", "ADMIN", "SENIOR_MODERATOR", "MODERATOR"],
  admin: ["ADMIN", "SENIOR_MODERATOR", "MODERATOR"],
  senior_moderator: ["SENIOR_MODERATOR", "MODERATOR"],
  moderator: ["MODERATOR"],
};
/** SEC-M6-08: a staff session without a `sid` is rejected (an empty id would match itself in break-glass session binding). SEC-M6-09: moderator roles are live. */
export const staffOf = (a: Actor): Staff & { sessionId: string } => {
  if (!a.sid) throw new HttpError(401, "unauthenticated", "Sign in required");
  return { id: a.id, roles: STAFF_ROLES[a.role] ?? [], stepUpAt: a.stepUpAt ?? null, sessionId: a.sid };
};
export const clock = systemClock;
/** SEC-M6-08: alerts go to a real sink (an outbox event routed to the worker, which pages SECURITY_ALERT_EMAIL); stderr stays as the fallback. */
export const makeAlert = (database: { outboxEvent: { create(a: unknown): Promise<unknown> } }) => (kind: string, detail: Record<string, unknown>): void => {
  console.error(JSON.stringify({ msg: "security.alert", channel: "security-channel", kind, ...detail }));
  void database.outboxEvent.create({ data: { type: "security.alert", aggregateId: kind, payload: { kind, ...Object.fromEntries(Object.entries(detail).filter(([, v]) => typeof v === "string" || typeof v === "number")) } } }).catch((e: Error) => console.error(JSON.stringify({ msg: "security.alert.sink_failed", err: e.message })));
};
export const alert = makeAlert(db as never);
export const m6db = db as never;
