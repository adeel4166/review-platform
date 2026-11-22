import { EMAIL_TOKEN_TTL_MS, appUrl, generateEmailToken, hashEmailToken, renderMail, type MailProvider, systemClock } from "@rp/core";

const NOTICE_INTERVAL_MS = 60 * 60 * 1000;

export interface EmailDb {
  emailVerificationToken: {
    findUnique(args: unknown): Promise<{ id: string; email: string; purpose: string; claimId?: string | null; sentAt: Date | null; consumedAt: Date | null; invalidatedAt: Date | null; expiresAt: Date } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  user: {
    findUnique(args: unknown): Promise<{ id: string; email: string; emailVerifiedAt: Date | null } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}
export interface InvitationRow { id: string; email: string; sentAt: Date | null; acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }
export interface EmailDbInvitations {
  sellerInvitation: {
    findUnique(args: unknown): Promise<InvitationRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}
export interface EmailDeps { db: EmailDb & Partial<EmailDbInvitations>; mail: MailProvider; baseUrl?: string; now?: () => Date }

export type EmailOutcome = "SENT" | "SKIPPED";

/**
 * notifications `user.email_verification_requested` {tokenId} (ADR-0016 §3.4). The raw token exists only here and in the mail:
 * it is never logged, queued or stored (only its SHA-256). A retry after a crash rotates the hash, so the last mailed link wins.
 */
export async function sendVerificationEmail(d: EmailDeps, tokenId: string, jobKey: string): Promise<EmailOutcome> {
  const now = (d.now ?? (() => systemClock.now()))();
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
  const now = (d.now ?? (() => systemClock.now()))();
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

/**
 * notifications `seller.invitation_created` {invitationId} (M3 spec §3.4 / §4.3). Same pattern as the account token: the raw
 * token exists only here and in the mail; only its SHA-256 is stored. The expiry set at creation (7 days, SEL-007) is
 * never extended by a retry, and a retry rotates the hash so the last mailed link wins.
 */
export async function sendSellerInvitationEmail(d: EmailDeps, invitationId: string, jobKey: string): Promise<EmailOutcome> {
  const now = (d.now ?? (() => systemClock.now()))();
  const inv = d.db.sellerInvitation;
  if (!inv) throw new Error("sellerInvitation delegate missing");
  const row = await inv.findUnique({ where: { id: invitationId } });
  if (!row || row.acceptedAt || row.revokedAt || row.expiresAt <= now) return "SKIPPED";
  const raw = generateEmailToken();
  const claimed = await inv.updateMany({
    where: { id: row.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    data: { tokenHash: hashEmailToken(raw) },
  });
  if (claimed.count !== 1) return "SKIPPED";
  await d.mail.send(renderMail("seller_invitation", row.email, { url: `${d.baseUrl ?? appUrl()}/invitations/accept?token=${raw}` }), { idempotencyKey: jobKey });
  await inv.updateMany({ where: { id: row.id }, data: { sentAt: now } });
  return "SENT";
}

export interface ClaimEmailDeps {
  db: EmailDb & {
    sellerOwnershipClaim: { findUnique(args: unknown): Promise<{ domain: string | null; status: string; seller: { slug: string } } | null> };
  };
  mail: MailProvider; baseUrl?: string; now?: () => Date;
}

/**
 * notifications `claim.business_email_token_requested` {claimId, tokenId} (m3b-spec 4.4 / 4.7). Same pattern as the account token:
 * raw token only in the mail, SHA-256 at rest, a retry rotates the hash. The mail is `Auto-Submitted: auto-generated` (SEL-036).
 */
export async function sendClaimBusinessEmail(d: ClaimEmailDeps, tokenId: string, jobKey: string): Promise<EmailOutcome> {
  const now = (d.now ?? (() => systemClock.now()))();
  const row = await d.db.emailVerificationToken.findUnique({ where: { id: tokenId }, select: { id: true, email: true, purpose: true, claimId: true, sentAt: true, consumedAt: true, invalidatedAt: true, expiresAt: true } });
  if (!row || row.purpose !== "CLAIM_BUSINESS_EMAIL" || row.consumedAt || row.invalidatedAt || row.expiresAt <= now) return "SKIPPED";
  const claimId = row.claimId;
  if (!claimId) return "SKIPPED";
  const claim = await d.db.sellerOwnershipClaim.findUnique({ where: { id: claimId }, select: { domain: true, status: true, seller: { select: { slug: true } } } });
  if (!claim || claim.status !== "PENDING") return "SKIPPED";
  const raw = generateEmailToken();
  const claimed = await d.db.emailVerificationToken.updateMany({ where: { id: row.id, consumedAt: null, invalidatedAt: null }, data: { tokenHash: hashEmailToken(raw) } });
  if (claimed.count !== 1) return "SKIPPED";
  const base = d.baseUrl ?? appUrl();
  await d.mail.send(renderMail("claim_business_email", row.email, { url: `${base}/claims/email-verify?token=${raw}`, domain: claim.domain ?? row.email.split("@")[1] ?? "", sellerUrl: `${base}/sellers/${claim.seller.slug}` }), { idempotencyKey: jobKey });
  await d.db.emailVerificationToken.updateMany({ where: { id: row.id }, data: { sentAt: now } });
  return "SENT";
}

/** Fixed copy per alert kind (SEC-M3B-01). Unknown kinds are not mailed. No code, secret, IP or token is ever included. */
export const SECURITY_ALERT_COPY: Record<string, { headline: string; detail: string }> = {
  SECOND_FACTOR_FAILURES: { headline: "Failed two-factor sign-in attempts", detail: "There were several failed attempts to enter a two-factor code after your password was accepted." },
  RECOVERY_CODE_USED: { headline: "A recovery code was used to sign in", detail: "One of your two-factor recovery codes was used. Each code works only once." },
  STAFF_RECOVERY_USED: { headline: "A recovery code was used on a staff account", detail: "A two-factor recovery code was used to sign in to your staff account." },
  TWO_FACTOR_ENABLED: { headline: "Two-factor authentication was turned on", detail: "Two-factor authentication was enabled on your account." },
  TWO_FACTOR_REPLACED: { headline: "Your two-factor authenticator was replaced", detail: "The authenticator app linked to your account was replaced." },
  TWO_FACTOR_RESET: { headline: "Your two-factor authentication was reset by staff", detail: "Two-factor authentication was removed from your account by an administrator after a four-eyes approval, and your sessions were signed out. If you did not expect this, contact support immediately." },
  TWO_FACTOR_DISABLED: { headline: "Two-factor authentication was turned off", detail: "Two-factor authentication was disabled on your account." },
};

export interface SecurityAlertDb { user: { findUnique(args: unknown): Promise<{ email: string; status?: string } | null> } }

/** notifications `auth.security_alert` {userId, kind, remaining?}: one fixed-text mail to the account address. Skips unknown kinds and inactive accounts. */
export async function sendSecurityAlertEmail(d: { db: SecurityAlertDb; mail: MailProvider; baseUrl?: string }, payload: { userId?: string; kind?: string; remaining?: number }, jobKey: string): Promise<EmailOutcome> {
  const copy = payload.kind ? SECURITY_ALERT_COPY[payload.kind] : undefined;
  if (payload.userId && !copy) console.error(JSON.stringify({ msg: "security.alert.unknown_kind", kind: String(payload.kind ?? "").slice(0, 64) })); // never a silent drop (SEC-M6-04)
  if (!payload.userId || !copy) return "SKIPPED";
  const u = await d.db.user.findUnique({ where: { id: payload.userId }, select: { email: true, status: true } });
  if (!u || (u.status ?? "ACTIVE") !== "ACTIVE") return "SKIPPED";
  const detail = payload.kind === "RECOVERY_CODE_USED" && Number.isInteger(payload.remaining) ? `${copy.detail} Unused recovery codes left: ${payload.remaining}.` : copy.detail;
  await d.mail.send(renderMail("security_alert", u.email, { url: `${d.baseUrl ?? appUrl()}/account`, headline: copy.headline, detail }), { idempotencyKey: jobKey });
  return "SENT";
}

/** Fixed one-line copy per notification type for the `notification.email` job (NTF-001): no review text, no names. Mail is resolved from the DB by userId. */
const NOTIFICATION_COPY: Record<string, { headline: string; detail: string }> = {
  CONTENT_HELD: { headline: "Your content is under review", detail: "Your content is being checked by our team before it is shown. You can see the status in your account." },
  CONTENT_REJECTED: { headline: "Your content was not published", detail: "Your content did not meet our guidelines. The reason and how to appeal are in your account." },
  CONTENT_REMOVED: { headline: "Your content was removed", detail: "Your content was removed. The reason and how to appeal are in your account." },
  CONTENT_RESTORED: { headline: "Your content was restored", detail: "Your content has been restored after a review." },
  REVIEW_PUBLISHED: { headline: "Your review is live", detail: "Your review has been published." },
  APPEAL_RECEIVED: { headline: "We received your appeal", detail: "Your appeal was received and will be reviewed." },
  APPEAL_DECIDED: { headline: "Your appeal has a decision", detail: "A decision on your appeal is available in your account." },
};
export async function sendNotificationEmail(d: { db: SecurityAlertDb; mail: MailProvider; baseUrl?: string }, payload: { userId?: string; type?: string }, jobKey: string): Promise<EmailOutcome> {
  const copy = payload.type ? NOTIFICATION_COPY[payload.type] : undefined;
  if (!payload.userId || !copy) return "SKIPPED";
  const u = await d.db.user.findUnique({ where: { id: payload.userId }, select: { email: true, status: true } });
  if (!u || (u.status ?? "ACTIVE") !== "ACTIVE") return "SKIPPED";
  await d.mail.send(renderMail("security_alert", u.email, { url: `${d.baseUrl ?? appUrl()}/account/notifications`, headline: copy.headline, detail: copy.detail }), { idempotencyKey: jobKey });
  return "SENT";
}
