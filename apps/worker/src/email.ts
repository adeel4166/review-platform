import { EMAIL_TOKEN_TTL_MS, appUrl, generateEmailToken, hashEmailToken, renderMail, type MailProvider } from "@rp/core";

const NOTICE_INTERVAL_MS = 60 * 60 * 1000;

export interface EmailDb {
  emailVerificationToken: {
    findUnique(args: unknown): Promise<{ id: string; email: string; purpose: string; sentAt: Date | null; consumedAt: Date | null; invalidatedAt: Date | null; expiresAt: Date } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  user: {
    findUnique(args: unknown): Promise<{ id: string; email: string; emailVerifiedAt: Date | null } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}
export interface EmailDeps { db: EmailDb; mail: MailProvider; baseUrl?: string; now?: () => Date }

export type EmailOutcome = "SENT" | "SKIPPED";

/**
 * notifications `user.email_verification_requested` {tokenId} (ADR-0016 §3.4). The raw token exists only here and in the mail:
 * it is never logged, queued or stored (only its SHA-256). A retry after a crash rotates the hash, so the last mailed link wins.
 */
export async function sendVerificationEmail(d: EmailDeps, tokenId: string, jobKey: string): Promise<EmailOutcome> {
  const now = (d.now ?? (() => new Date()))();
  const row = await d.db.emailVerificationToken.findUnique({ where: { id: tokenId } });
  if (!row || row.purpose !== "ACCOUNT_EMAIL" || row.consumedAt || row.invalidatedAt || row.expiresAt <= now) return "SKIPPED";
  const raw = generateEmailToken();
  const claimed = await d.db.emailVerificationToken.updateMany({
    where: { id: row.id, consumedAt: null, invalidatedAt: null },
    data: { tokenHash: hashEmailToken(raw), expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS) },
  });
  if (claimed.count !== 1) return "SKIPPED";
  await d.mail.send(renderMail("verify_account", row.email, { url: `${d.baseUrl ?? appUrl()}/verify-email?token=${raw}` }), { idempotencyKey: jobKey });
  await d.db.emailVerificationToken.updateMany({ where: { id: row.id }, data: { sentAt: now } });
  return "SENT";
}

/** notifications `user.registration_conflict` {userId}: "someone tried to register", at most one per hour. No token inside. */
export async function sendAccountExistsEmail(d: EmailDeps, userId: string, jobKey: string): Promise<EmailOutcome> {
  const now = (d.now ?? (() => new Date()))();
  const user = await d.db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, emailVerifiedAt: true } });
  if (!user) return "SKIPPED";
  const claimed = await d.db.user.updateMany({
    where: { id: userId, OR: [{ accountExistsNoticeAt: null }, { accountExistsNoticeAt: { lt: new Date(now.getTime() - NOTICE_INTERVAL_MS) } }] },
    data: { accountExistsNoticeAt: now },
  });
  if (claimed.count !== 1) return "SKIPPED";
  await d.mail.send(renderMail("account_exists", user.email, { url: `${d.baseUrl ?? appUrl()}/login` }), { idempotencyKey: jobKey });
  return "SENT";
}
