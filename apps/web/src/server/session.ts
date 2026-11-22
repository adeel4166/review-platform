import { systemClock } from "@rp/core";
import { auth, type AppRole } from "./auth";
import { HttpError } from "./http";
import { assertFreshStepUp } from "./user-sessions";

export interface Actor {
  id: string;
  role: AppRole;
  sid?: string;
  twoFactor?: { enrolled: boolean; verified: boolean };
  stepUpAt?: number | null;
}

/** Resolves the authenticated actor or throws 401. Routes import this (not Auth.js) so tests can mock it. */
export async function requireUser(): Promise<Actor> {
  const s = await auth();
  // Fail closed: an error-populated session object (e.g. { error: ... }) or a missing/blank id is never authenticated.
  if (s && (s as { pending?: unknown }).pending) throw new HttpError(401, "second_factor_pending", "Second factor required"); // still a denial
  const id = s?.user?.id;
  if (!s || "error" in s || typeof id !== "string" || id.trim() === "") {
    throw new HttpError(401, "unauthenticated", "Sign in required");
  }
  return { id, role: s.user.role, sid: s.user.sid, twoFactor: s.user.twoFactor, stepUpAt: s.user.stepUpAt };
}

/** Admin-only gate: 401 when signed out, 403 for non-admins. */
export async function requireAdmin(): Promise<Actor> {
  const a = await requireUser();
  if (a.role !== "admin" && a.role !== "super_admin") throw new HttpError(403, "forbidden", "Admin access required");
  return requireTwoFactor(a);
}

/** SEC-M6-09: moderation-desk gate (MODERATOR and above). Proofs, break-glass, config and role routes stay on `requireAdmin`. */
export async function requireModerator(): Promise<Actor> {
  const a = await requireUser();
  if (!["moderator", "senior_moderator", "admin", "super_admin"].includes(a.role)) throw new HttpError(403, "forbidden", "Moderator access required");
  return requireTwoFactor(a);
}

/** SUPER_ADMIN-only gate (staff role management, ADR-0003 `role.grant.*`): 401 signed out, 403 for everyone else, ADMIN included. */
export async function requireSuperAdmin(): Promise<Actor> {
  const a = await requireUser();
  if (a.role !== "super_admin") throw new HttpError(403, "forbidden", "Super admin access required");
  return requireTwoFactor(a);
}

/** Staff gate (m3b-spec 2.9): 2FA must be enrolled AND verified in this session, otherwise every staff permission is inactive. */
export function requireTwoFactor(a: Actor): Actor {
  if (!a.twoFactor?.enrolled || !a.twoFactor.verified) throw new HttpError(403, "TWO_FACTOR_REQUIRED", "Two-factor authentication required");
  return a;
}

/** Step-up helper for sensitive actions: 401 STEP_UP_REQUIRED unless re-authenticated within 10 minutes (ADR-0002 section 4). */
export function requireStepUp(a: Actor, now = systemClock.now()): Actor {
  assertFreshStepUp(a.stepUpAt, now);
  return a;
}
