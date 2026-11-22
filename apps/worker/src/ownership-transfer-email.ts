import { appUrl, generateEmailToken, hashEmailToken, renderMail, type MailProvider } from "@rp/core";

const HOUR_MS = 3_600_000;
export const REMINDER_LEAD_MS = 24 * HOUR_MS;

export interface TransferNotifyDb {
  sellerOwnershipTransfer: { findUnique(a: unknown): Promise<{ id: string; kind: string; status: string; initiatorId: string; targetUserId: string; executeAfter: Date; seller: { slug: string } } | null> };
  sellerTransferCancelToken: {
    findMany(a: unknown): Promise<Array<{ id: string; recipientId: string; sentAt: Date | null }>>;
    updateMany(a: unknown): Promise<{ count: number }>;
  };
  user: { findMany(a: unknown): Promise<Array<{ id: string; email: string; handle: string }>> };
}
export type TransferStage = "REQUESTED" | "REMINDER";
export interface TransferNotifyResult { outcome: "SENT" | "SKIPPED"; executeAfter?: Date }

/**
 * notifications `seller.ownership_transfer_requested` / `…_reminder` {transferId} (m3b-spec 3.5, SEL-023/024). One cancel token per
 * recipient row: the raw token (32 random bytes) exists only in the mail, only its SHA-256 is stored. The link matches the cancel page (?token=). REQUESTED skips rows already mailed (a retry never re-mails); REMINDER re-mints every unused row, and replacing the
 * hash is what invalidates the earlier link. Nothing is sent once the transfer is no longer PENDING/ACCEPTED.
 */
export async function sendTransferCancelLinks(d: { db: TransferNotifyDb; mail: MailProvider; baseUrl?: string; now?: () => Date }, transferId: string, stage: TransferStage, jobKey: string): Promise<TransferNotifyResult> {
  const now = (d.now ?? (() => new Date()))();
  const t = await d.db.sellerOwnershipTransfer.findUnique({ where: { id: transferId }, select: { id: true, kind: true, status: true, initiatorId: true, targetUserId: true, executeAfter: true, seller: { select: { slug: true } } } });
  if (!t || (t.status !== "PENDING" && t.status !== "ACCEPTED")) return { outcome: "SKIPPED" };
  const rows = (await d.db.sellerTransferCancelToken.findMany({ where: { transferId, usedAt: null } })).filter((r) => stage === "REMINDER" || !r.sentAt);
  if (!rows.length) return { outcome: "SKIPPED", executeAfter: t.executeAfter };
  const users = await d.db.user.findMany({ where: { id: { in: [...new Set([...rows.map((r) => r.recipientId), t.initiatorId, t.targetUserId])] } }, select: { id: true, email: true, handle: true, status: true, emailVerifiedAt: true } });
  const byId = new Map(users.map((u) => [u.id, u as typeof u & { status?: string; emailVerifiedAt?: Date | null }]));
  const base = d.baseUrl ?? appUrl();
  let sent = 0;
  for (const row of rows) {
    const u = byId.get(row.recipientId);
    if (!u || u.status !== "ACTIVE" || !u.emailVerifiedAt) continue;
    const raw = generateEmailToken();
    const claimed = await d.db.sellerTransferCancelToken.updateMany({ where: { id: row.id, usedAt: null }, data: { tokenHash: hashEmailToken(raw) } });
    if (claimed.count !== 1) continue; // used meanwhile
    await d.mail.send(
      renderMail("ownership_transfer", u.email, {
        url: `${base}/ownership-transfers/cancel?token=${raw}`, sellerUrl: `${base}/sellers/${t.seller.slug}`, kind: t.kind === "REMOVE_OWNER" ? "Owner removal" : "Ownership transfer",
        initiator: byId.get(t.initiatorId)?.handle ?? "", target: byId.get(t.targetUserId)?.handle ?? "", executeAfter: t.executeAfter.toISOString(), reminder: stage === "REMINDER" ? "1" : "0",
      }),
      { idempotencyKey: `${jobKey}:${row.recipientId}` },
    );
    await d.db.sellerTransferCancelToken.updateMany({ where: { id: row.id }, data: { sentAt: now } });
    sent++;
  }
  return { outcome: sent ? "SENT" : "SKIPPED", executeAfter: t.executeAfter };
}

/** Delay for the T - 24 h reminder, or null when that moment has already passed (nothing to schedule). */
export const reminderDelayMs = (executeAfter: Date, now: Date): number | null => {
  const d = executeAfter.getTime() - REMINDER_LEAD_MS - now.getTime();
  return d > 0 ? d : null;
};
