/** Server-side session rows behind the Auth.js JWT carrier (m3b-spec 2.1, 2.4, ADR-0019). */
import type { PrismaClient } from "@rp/db";
import { HttpError } from "./http";

export type SessionDb = { userSession: PrismaClient["userSession"] };
type SessionRow = NonNullable<Awaited<ReturnType<PrismaClient["userSession"]["findUnique"]>>>;

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
export const PENDING_TTL_MS = 10 * MIN;
export const STEP_UP_TTL_MS = 10 * MIN;
export const SUCCESSOR_CLAIM_MS = 60_000;
export const TOUCH_INTERVAL_MS = 5 * MIN;
export const MAX_SESSION_FAILURES = 5;

/** Staff (any UserRole row) get short sessions; everyone else long ones. */
export const lifetimes = (staff: boolean) => (staff ? { idle: 2 * HOUR, absolute: 12 * HOUR } : { idle: 30 * DAY, absolute: 90 * DAY });

export async function createSession(db: SessionDb, o: { userId: string; pending: boolean; staff: boolean; now: Date }): Promise<string> {
  const row = await db.userSession.create({
    data: {
      userId: o.userId,
      secondFactorPending: o.pending,
      pendingExpiresAt: o.pending ? new Date(o.now.getTime() + PENDING_TTL_MS) : null,
      authTime: o.now,
      absoluteExpiresAt: new Date(o.now.getTime() + lifetimes(o.staff).absolute),
      lastSeenAt: o.now,
    },
    select: { id: true },
  });
  return row.id;
}

export type SessionVerdict = "ok" | "claim_successor" | "dead";

/** Pure decision for a session row on each request (m3b-spec 2.1 table). */
export function sessionVerdict(row: SessionRow | null, userId: string, staff: boolean, now: Date): SessionVerdict {
  if (!row || row.userId !== userId) return "dead";
  if (row.revokedAt) {
    const fresh = row.revokeReason === "rotated" && !!row.successorId && !row.successorClaimedAt && now.getTime() - row.revokedAt.getTime() < SUCCESSOR_CLAIM_MS;
    return fresh ? "claim_successor" : "dead";
  }
  const { idle } = lifetimes(staff);
  if (now > row.absoluteExpiresAt || now.getTime() > row.lastSeenAt.getTime() + idle) return "dead";
  if (row.secondFactorPending && (!row.pendingExpiresAt || now > row.pendingExpiresAt)) return "dead";
  return "ok";
}

/** Claims the successor exactly once; returns its id, or null if someone else already did. */
export async function claimSuccessor(db: SessionDb, row: SessionRow, now: Date): Promise<string | null> {
  const r = await db.userSession.updateMany({ where: { id: row.id, successorClaimedAt: null }, data: { successorClaimedAt: now } });
  return r.count === 1 ? row.successorId : null;
}

export async function revokeOtherSessions(db: SessionDb, userId: string, keepId: string | null, reason: string, now: Date): Promise<number> {
  const r = await db.userSession.updateMany({
    where: { userId, revokedAt: null, ...(keepId ? { id: { not: keepId } } : {}) },
    data: { revokedAt: now, revokeReason: reason },
  });
  return r.count;
}

export async function revokeSession(db: SessionDb, id: string, reason: string, now: Date) {
  await db.userSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now, revokeReason: reason } });
}

/**
 * Replaces `old` with a verified successor in the caller's transaction. The revoke is a compare-and-set, so two
 * concurrent completions cannot both rotate the same row (enrolment race).
 */
export async function rotateToVerified(tx: SessionDb, old: SessionRow, method: "TOTP" | "RECOVERY_CODE", now: Date, carryStepUp: boolean): Promise<string> {
  const cas = await tx.userSession.updateMany({ where: { id: old.id, revokedAt: null }, data: { revokedAt: now, revokeReason: "rotated" } });
  if (cas.count !== 1) throw new HttpError(409, "conflict", "Session already changed");
  const next = await tx.userSession.create({
    data: {
      userId: old.userId,
      secondFactorPending: false,
      secondFactorVerifiedAt: now,
      secondFactorMethod: method,
      authTime: old.authTime,
      reauthenticatedAt: carryStepUp ? old.reauthenticatedAt : null,
      absoluteExpiresAt: old.absoluteExpiresAt,
      lastSeenAt: now,
    },
    select: { id: true },
  });
  await tx.userSession.update({ where: { id: old.id }, data: { successorId: next.id } });
  return next.id;
}

/** Throws 401 STEP_UP_REQUIRED unless the session re-authenticated within the last 10 minutes. */
export function assertFreshStepUp(stepUpAt: number | Date | null | undefined, now = new Date()): void {
  const t = stepUpAt instanceof Date ? stepUpAt.getTime() : stepUpAt;
  if (t == null || now.getTime() - t > STEP_UP_TTL_MS || t > now.getTime() + 1000) {
    throw new HttpError(401, "STEP_UP_REQUIRED", "Re-authentication required");
  }
}
