import { systemClock, type StaffRole } from "@rp/core";
import { db } from "./db";
import type { Actor } from "./session";
import type { Staff } from "./approvals";

/** Maps the session role to staff roles for the four-eyes service (ADMIN is a subset of SUPER_ADMIN). */
export const staffOf = (a: Actor): Staff & { sessionId: string } => ({
  id: a.id,
  roles: (a.role === "super_admin" ? ["SUPER_ADMIN", "ADMIN"] : a.role === "admin" ? ["ADMIN"] : []) as StaffRole[],
  stepUpAt: a.stepUpAt ?? null,
  sessionId: a.sid ?? "",
});
export const clock = systemClock;
export const alert = (kind: string, detail: Record<string, unknown>) => console.error(JSON.stringify({ msg: "security.alert", channel: "security-channel", kind, ...detail }));
export const m6db = db as never;
