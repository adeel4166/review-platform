/** TOTP 2FA service (m3b-spec 2.2-2.8, ADR-0019). All state lives in the database; Redis only throttles. */
import {
  assertAuditMetadataClean, generateRecoveryCode, generateTotpSecret, hashRecoveryCode, isRecoveryCodeShape, matchTotp, openSecret,
  otpauthUri, parseKeyRing, RECOVERY_CODE_COUNT, sealSecret, base32Encode, totpAad, type KeyRing,
} from "@rp/core";
import type { Prisma, PrismaClient } from "@rp/db";
import { randomUUID } from "node:crypto";
import { HttpError } from "./http";
import { assertFreshStepUp, MAX_SESSION_FAILURES, revokeOtherSessions, revokeSession, rotateToVerified } from "./user-sessions";

type Tx = Prisma.TransactionClient;
export type TfDb = Pick<PrismaClient, "$transaction" | "userSession" | "twoFactorTotp" | "recoveryCode" | "user" | "userRole" | "auditLog" | "outboxEvent">;
export type LimitKind = "attempt" | "enrol" | "regenerate" | "disable";

export interface TfDeps {
  now: () => Date;
  totpKeys: () => KeyRing;
  peppers: () => KeyRing;
  /** Throws 429 (per-account / per-IP caps) or 503 when the limiter is unavailable. Must run before any code is checked. */
  limit: (kind: LimitKind, userId: string) => Promise<void>;
}

export const ENROL_TTL_MS = 15 * 60_000;

export function envDeps(limit: TfDeps["limit"]): TfDeps {
  return {
    now: () => new Date(),
    totpKeys: () => parseKeyRing(process.env.TOTP_ENC_KEYS, process.env.TOTP_ENC_ACTIVE_KEY_ID),
    peppers: () => parseKeyRing(process.env.RECOVERY_CODE_PEPPERS, process.env.RECOVERY_CODE_ACTIVE_KEY_ID),
    limit,
  };
}

/** Audit rows carry ids, enums and counters only: never codes, secrets or IPs (AUT-013). */
const audit = (tx: Tx | TfDb, userId: string, action: string, metadata: Prisma.InputJsonObject = {}) => {
  assertAuditMetadataClean(metadata);
  return tx.auditLog.create({ data: { actorType: "USER", actorId: userId, action, entityType: "User", entityId: userId, metadata } });
};
const alertEvent = (tx: Tx | TfDb, userId: string, payload: Prisma.InputJsonObject) =>
  tx.outboxEvent.create({ data: { type: "auth.security_alert", aggregateId: userId, payload: { userId, ...payload } } });

const isStaff = async (db: Tx | TfDb, userId: string) => (await db.userRole.count({ where: { userId } })) > 0;

type CodeResult = { ok: false } | { ok: true; method: "TOTP" | "RECOVERY_CODE"; remaining?: number };

/** Checks one TOTP or recovery code. TOTP replay and recovery single-use are conditional UPDATEs (race-safe). */
async function checkCode(tx: Tx, deps: TfDeps, userId: string, code: string): Promise<CodeResult> {
  const trimmed = code.trim();
  if (/^\d{6}$/.test(trimmed)) {
    const row = await tx.twoFactorTotp.findUnique({ where: { userId } });
    if (!row?.secretCiphertext || !row.keyId || !row.confirmedAt) return { ok: false };
    let step: number | null;
    try {
      step = matchTotp(openSecret(deps.totpKeys(), row.keyId, row.secretCiphertext, totpAad(userId, row.id)), trimmed, deps.now().getTime());
    } catch {
      return { ok: false };
    }
    if (step === null) return { ok: false };
    const won = await tx.twoFactorTotp.updateMany({
      where: { userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(step) } }] },
      data: { lastUsedStep: BigInt(step) },
    });
    return won.count === 1 ? { ok: true, method: "TOTP" } : { ok: false }; // 0 rows = replay (AUT-004)
  }
  if (!isRecoveryCodeShape(trimmed)) return { ok: false };
  const ring = deps.peppers();
  const hashes = Object.values(ring.keys).map((k) => hashRecoveryCode(k, trimmed));
  const used = await tx.recoveryCode.updateMany({ where: { userId, codeHash: { in: hashes }, usedAt: null }, data: { usedAt: deps.now() } });
  if (used.count !== 1) return { ok: false };
  return { ok: true, method: "RECOVERY_CODE", remaining: await tx.recoveryCode.count({ where: { userId, usedAt: null } }) };
}

async function newRecoveryCodes(tx: Tx, deps: TfDeps, userId: string): Promise<string[]> {
  const ring = deps.peppers();
  await tx.recoveryCode.deleteMany({ where: { userId } });
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  await tx.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(ring.keys[ring.active]!, c), keyId: ring.active })) });
  return codes;
}

export async function twoFactorStatus(db: TfDb, userId: string) {
  const row = await db.twoFactorTotp.findUnique({ where: { userId }, select: { confirmedAt: true, pendingExpiresAt: true } });
  return {
    enabled: !!row?.confirmedAt,
    enrolling: !!row?.pendingExpiresAt && row.pendingExpiresAt > new Date(),
    recoveryCodesRemaining: await db.recoveryCode.count({ where: { userId, usedAt: null } }),
  };
}

/** Sign-in second factor. Only callable for a pending session; the 5-attempt cap is reserved atomically before the code is checked. */
export async function verifySecondFactor(db: TfDb, deps: TfDeps, o: { sid: string; userId: string; code: string; kind: "TOTP" | "RECOVERY_CODE" }) {
  await deps.limit("attempt", o.userId); // fail closed: nothing below runs when the limiter refuses
  const now = deps.now();
  const gone = () => new HttpError(401, "session_ended", "Sign in again");
  const row = await db.userSession.findUnique({ where: { id: o.sid } });
  if (!row || row.userId !== o.userId || row.revokedAt || !row.secondFactorPending || !row.pendingExpiresAt || row.pendingExpiresAt <= now) throw gone();
  const isRecovery = isRecoveryCodeShape(o.code) && !/^\d{6}$/.test(o.code.trim());

  const reserved = await db.userSession.updateMany({
    where: { id: o.sid, revokedAt: null, secondFactorPending: true, twoFactorFailures: { lt: MAX_SESSION_FAILURES } },
    data: { twoFactorFailures: { increment: 1 } },
  });
  if (reserved.count !== 1) {
    await revokeSession(db, o.sid, "second_factor_failed", now);
    throw gone();
  }

  const result = await db.$transaction(async (tx) => {
    const code = o.kind === "TOTP" ? (/^\d{6}$/.test(o.code.trim()) ? o.code : "") : isRecovery ? o.code : "";
    const r = code ? await checkCode(tx, deps, o.userId, code) : ({ ok: false } as const);
    if (!r.ok) return null;
    const staff = await isStaff(tx, o.userId);
    if (r.method === "RECOVERY_CODE" && staff) {
      // Staff recovery: drop the TOTP secret and the unused codes, so staff routes stay 403 until re-enrolment (AUT-023).
      await tx.twoFactorTotp.deleteMany({ where: { userId: o.userId } });
      await tx.recoveryCode.deleteMany({ where: { userId: o.userId, usedAt: null } });
      await revokeOtherSessions(tx, o.userId, o.sid, "recovery_used", now);
      await alertEvent(tx, o.userId, { kind: "STAFF_RECOVERY_USED" });
    }
    if (r.method === "RECOVERY_CODE") {
      await alertEvent(tx, o.userId, { kind: "RECOVERY_CODE_USED", remaining: r.remaining ?? 0 });
      await audit(tx, o.userId, "auth.recovery_code.used", { remaining: r.remaining ?? 0 });
    }
    const sid = await rotateToVerified(tx, row, r.method, now, false);
    await audit(tx, o.userId, "auth.2fa.verified", { method: r.method });
    return { sid, method: r.method };
  });
  if (result) return result;

  const after = await db.userSession.findUnique({ where: { id: o.sid }, select: { twoFactorFailures: true } });
  const failures = after?.twoFactorFailures ?? MAX_SESSION_FAILURES;
  await audit(db, o.userId, "auth.2fa.failed", { method: o.kind, sessionFailures: failures });
  if (failures === 3) {
    // AUT-022: one SECOND_FACTOR_FAILURES alert per ACCOUNT per hour, however many pending sessions reach their 3rd failure.
    const recent = await db.outboxEvent.count({
      where: { type: "auth.security_alert", aggregateId: o.userId, createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) }, payload: { path: "$.kind", equals: "SECOND_FACTOR_FAILURES" } },
    });
    if (recent === 0) await db.outboxEvent.create({ data: { type: "auth.security_alert", aggregateId: o.userId, createdAt: now, payload: { userId: o.userId, kind: "SECOND_FACTOR_FAILURES" } } });
  }
  if (failures >= MAX_SESSION_FAILURES) {
    await revokeSession(db, o.sid, "second_factor_failed", now);
    await audit(db, o.userId, "auth.2fa.session_killed");
    throw gone();
  }
  throw new HttpError(400, "invalid_code", "Invalid code");
}

/** E1/E4: stores a pending secret. Replacing an active secret requires the current code. */
export async function startEnrolment(db: TfDb, deps: TfDeps, o: { userId: string; stepUpAt: number | null; currentCode?: string }) {
  const now = deps.now();
  assertFreshStepUp(o.stepUpAt, now);
  await deps.limit("enrol", o.userId);
  const user = await db.user.findUnique({ where: { id: o.userId }, select: { emailVerifiedAt: true, email: true } });
  if (!user?.emailVerifiedAt) throw new HttpError(403, "email_unverified", "Verify your email first");
  const existing = await db.twoFactorTotp.findUnique({ where: { userId: o.userId }, select: { id: true, confirmedAt: true } });
  if (existing?.confirmedAt) {
    if (!o.currentCode) throw new HttpError(400, "code_required", "Current code required");
    await deps.limit("attempt", o.userId);
    const ok = await db.$transaction((tx) => checkCode(tx, deps, o.userId, o.currentCode!));
    if (!ok.ok) throw new HttpError(400, "invalid_code", "Invalid code");
  }
  const secret = generateTotpSecret();
  const rowId = existing?.id ?? randomUUID(); // the row id is part of the AAD, so it is chosen first
  const box = sealSecret(deps.totpKeys(), secret, totpAad(o.userId, rowId));
  const pending = { pendingSecretCiphertext: new Uint8Array(box.ciphertext), pendingKeyId: box.keyId, pendingExpiresAt: new Date(now.getTime() + ENROL_TTL_MS) };
  if (existing) await db.twoFactorTotp.update({ where: { userId: o.userId }, data: pending });
  else await db.twoFactorTotp.create({ data: { id: rowId, userId: o.userId, ...pending } });
  await audit(db, o.userId, "auth.2fa.enrol_started");
  return { otpauthUri: otpauthUri(secret, user.email), secret: base32Encode(secret) };
}

/** E2/E5: confirms the pending secret with a valid code. The move pending -> active is a compare-and-set (enrolment race). */
export async function confirmEnrolment(db: TfDb, deps: TfDeps, o: { userId: string; sid: string; code: string }) {
  await deps.limit("attempt", o.userId);
  const now = deps.now();
  const row = await db.twoFactorTotp.findUnique({ where: { userId: o.userId } });
  if (!row?.pendingSecretCiphertext || !row.pendingKeyId || !row.pendingExpiresAt || row.pendingExpiresAt <= now) {
    throw new HttpError(409, "no_pending_enrolment", "Start enrolment again");
  }
  let step: number | null = null;
  try {
    step = matchTotp(openSecret(deps.totpKeys(), row.pendingKeyId, row.pendingSecretCiphertext, totpAad(o.userId, row.id)), o.code.trim(), now.getTime());
  } catch { /* undecryptable pending secret: treated as a bad code */ }
  if (step === null) throw new HttpError(400, "invalid_code", "Invalid code");
  const first = !row.confirmedAt;
  const pendingSecret = row.pendingSecretCiphertext;
  return db.$transaction(async (tx) => {
    const cas = await tx.twoFactorTotp.updateMany({
      where: { id: row.id, pendingSecretCiphertext: pendingSecret, pendingExpiresAt: { gt: now } },
      data: { secretCiphertext: pendingSecret, keyId: row.pendingKeyId, confirmedAt: now, lastUsedStep: BigInt(step!), pendingSecretCiphertext: null, pendingKeyId: null, pendingExpiresAt: null },
    });
    if (cas.count !== 1) throw new HttpError(409, "enrolment_conflict", "Enrolment already completed or expired");
    const recoveryCodes = first ? await newRecoveryCodes(tx, deps, o.userId) : undefined;
    const cur = await tx.userSession.findUnique({ where: { id: o.sid } });
    if (!cur || cur.userId !== o.userId) throw new HttpError(401, "unauthenticated", "Sign in required");
    const revoked = await revokeOtherSessions(tx, o.userId, o.sid, "two_factor_changed", now);
    const sid = await rotateToVerified(tx, cur, "TOTP", now, true);
    await alertEvent(tx, o.userId, { kind: first ? "TWO_FACTOR_ENABLED" : "TWO_FACTOR_REPLACED" });
    await audit(tx, o.userId, first ? "auth.2fa.enabled" : "auth.2fa.replaced");
    await audit(tx, o.userId, "auth.session.revoked", { reason: "two_factor_changed", count: revoked });
    return { sid, recoveryCodes };
  });
}

export async function disableTwoFactor(db: TfDb, deps: TfDeps, o: { userId: string; sid: string; stepUpAt: number | null }) {
  const now = deps.now();
  assertFreshStepUp(o.stepUpAt, now);
  await deps.limit("disable", o.userId);
  return db.$transaction(async (tx) => {
    if (await isStaff(tx, o.userId)) throw new HttpError(409, "two_factor_required_by_role", "Staff accounts must keep 2FA enabled");
    const gone = await tx.twoFactorTotp.deleteMany({ where: { userId: o.userId } });
    if (gone.count === 0) throw new HttpError(409, "two_factor_not_enabled", "2FA is not enabled");
    await tx.recoveryCode.deleteMany({ where: { userId: o.userId } });
    const revoked = await revokeOtherSessions(tx, o.userId, o.sid, "two_factor_changed", now);
    await alertEvent(tx, o.userId, { kind: "TWO_FACTOR_DISABLED" });
    await audit(tx, o.userId, "auth.2fa.disabled");
    await audit(tx, o.userId, "auth.session.revoked", { reason: "two_factor_changed", count: revoked });
    return { disabled: true };
  });
}

export async function regenerateRecoveryCodes(db: TfDb, deps: TfDeps, o: { userId: string; stepUpAt: number | null }) {
  assertFreshStepUp(o.stepUpAt, deps.now());
  await deps.limit("regenerate", o.userId);
  return db.$transaction(async (tx) => {
    const t = await tx.twoFactorTotp.findUnique({ where: { userId: o.userId }, select: { confirmedAt: true } });
    if (!t?.confirmedAt) throw new HttpError(409, "two_factor_not_enabled", "2FA is not enabled");
    const recoveryCodes = await newRecoveryCodes(tx, deps, o.userId);
    await audit(tx, o.userId, "auth.recovery_codes.regenerated");
    return { recoveryCodes };
  });
}

/** Step-up: password, plus a TOTP or recovery code when 2FA is enabled. Every failure looks the same (invalid_credentials). */
export async function stepUp(db: TfDb, deps: TfDeps, o: { sid: string; userId: string; password: string; code?: string; verifyPassword: (hash: string, pw: string) => Promise<boolean> }) {
  await deps.limit("attempt", o.userId);
  const bad = () => new HttpError(400, "invalid_credentials", "Invalid credentials");
  const user = await db.user.findUnique({ where: { id: o.userId }, select: { passwordHash: true } });
  const pwOk = !!user?.passwordHash && (await o.verifyPassword(user.passwordHash, o.password));
  const enrolled = !!(await db.twoFactorTotp.findUnique({ where: { userId: o.userId }, select: { confirmedAt: true } }))?.confirmedAt;
  const now = deps.now();
  const ok = await db.$transaction(async (tx) => {
    let codeOk = true;
    if (pwOk && enrolled) {
      const r = o.code ? await checkCode(tx, deps, o.userId, o.code) : ({ ok: false } as CodeResult);
      codeOk = r.ok;
      if (r.ok && r.method === "RECOVERY_CODE") await alertEvent(tx, o.userId, { kind: "RECOVERY_CODE_USED", remaining: r.remaining ?? 0 });
    }
    const pass = pwOk && codeOk;
    if (pass) {
      const s = await tx.userSession.updateMany({ where: { id: o.sid, userId: o.userId, revokedAt: null, secondFactorPending: false }, data: { reauthenticatedAt: now } });
      if (s.count !== 1) return false;
    }
    await audit(tx, o.userId, "auth.step_up", { ok: pass });
    return pass;
  });
  if (!ok) throw bad();
  return { reauthenticatedAt: now.toISOString() };
}
