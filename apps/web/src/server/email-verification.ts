import { EMAIL_RESEND_PER_DAY, EMAIL_RESEND_PER_HOUR, EMAIL_TOKEN_TTL_MS, hashEmailToken, systemClock } from "@rp/core";
import { HttpError } from "./http";

/** The subset of Prisma used here (lets unit tests pass a fake). */
export interface VerifyDb {
  $transaction<T>(fn: (tx: VerifyDb) => Promise<T>): Promise<T>;
  emailVerificationToken: {
    findUnique(a: unknown): Promise<{ id: string; userId: string; purpose: string; email: string; sentAt: Date | null; consumedAt: Date | null; invalidatedAt: Date | null; expiresAt: Date } | null>;
    updateMany(a: unknown): Promise<{ count: number }>;
    create(a: unknown): Promise<{ id: string }>;
    count(a: unknown): Promise<number>;
  };
  user: { findUnique(a: unknown): Promise<{ id: string; email: string; emailVerifiedAt: Date | null } | null>; update(a: unknown): Promise<unknown> };
  outboxEvent: { create(a: unknown): Promise<unknown> };
  auditLog: { create(a: unknown): Promise<unknown> };
}

const invalid = () => new HttpError(400, "invalid_or_expired", "This link is invalid or has expired");

/**
 * Consumes an ACCOUNT_EMAIL token (ADR-0016 §3.3). Every failure (unknown, replayed, expired, invalidated, email changed)
 * yields the same 400, so the endpoint is not an oracle. Single use is enforced by an atomic conditional update.
 */
export async function verifyEmailToken(db: VerifyDb, raw: string, now = systemClock.now(), newPasswordHash?: string): Promise<void> {
  const row = await db.emailVerificationToken.findUnique({ where: { tokenHash: hashEmailToken(raw) } });
  if (!row || row.purpose !== "ACCOUNT_EMAIL" || !row.sentAt || row.consumedAt || row.invalidatedAt || row.expiresAt <= now) throw invalid();
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: row.userId }, select: { id: true, email: true, emailVerifiedAt: true } });
    if (!user || user.email !== row.email) throw invalid(); // bound to the current address
    const claimed = await tx.emailVerificationToken.updateMany({
      where: { id: row.id, consumedAt: null, invalidatedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) throw invalid(); // lost a replay race
    if (!user.emailVerifiedAt) {
      // T-02: whoever registered may not be the mailbox owner, so verification replaces the password. Writing
      // emailVerifiedAt also bumps the session version (auth.ts), which rejects every earlier session.
      if (!newPasswordHash) throw new HttpError(400, "password_required", "Choose a new password to confirm your email");
      await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now, passwordHash: newPasswordHash } });
    }
    await tx.emailVerificationToken.updateMany({
      where: { userId: user.id, purpose: "ACCOUNT_EMAIL", consumedAt: null, invalidatedAt: null },
      data: { invalidatedAt: now },
    });
    await tx.auditLog.create({ data: { actorType: "USER", actorId: user.id, action: "user.email_verified", entityType: "User", entityId: user.id } });
  });
}

/** Resend: invalidates open tokens, issues a fresh one and queues the mail. Always "accepted" for an unverified user. */
export async function resendVerification(db: VerifyDb, userId: string, now = systemClock.now()): Promise<"queued" | "already_verified" | "limited"> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, emailVerifiedAt: true } });
  if (!user) throw new HttpError(401, "unauthenticated", "Sign in required");
  if (user.emailVerifiedAt) return "already_verified";
  const since = (ms: number) => ({ gt: new Date(now.getTime() - ms) });
  const [hour, day] = await Promise.all([
    db.emailVerificationToken.count({ where: { userId, purpose: "ACCOUNT_EMAIL", createdAt: since(3600_000) } }),
    db.emailVerificationToken.count({ where: { userId, purpose: "ACCOUNT_EMAIL", createdAt: since(86_400_000) } }),
  ]);
  if (hour >= EMAIL_RESEND_PER_HOUR || day >= EMAIL_RESEND_PER_DAY) return "limited";
  await db.$transaction(async (tx) => {
    await tx.emailVerificationToken.updateMany({ where: { userId, purpose: "ACCOUNT_EMAIL", consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: now } });
    const t = await tx.emailVerificationToken.create({
      data: { userId, purpose: "ACCOUNT_EMAIL", email: user.email, expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS) },
      select: { id: true },
    });
    await tx.outboxEvent.create({ data: { type: "user.email_verification_requested", aggregateId: userId, payload: { tokenId: t.id } } });
  });
  return "queued";
}
