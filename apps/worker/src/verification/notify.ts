import { appUrl, renderMail, type MailProvider } from "@rp/core";

export interface NotifyDb {
  sellerOwnershipClaim: { findUnique(a: unknown): Promise<{ id: string; sellerId: string; conflictClaimId: string | null } | null>; };
  sellerMember: { findMany(a: unknown): Promise<Array<{ userId: string }>> };
  user: { findMany(a: unknown): Promise<Array<{ id: string; email: string }>> };
}

const HEADLINES: Record<string, string> = {
  "claim.verified": "Your ownership claim was approved",
  "claim.rejected": "Your ownership claim was rejected",
  "claim.expired": "Your ownership claim has expired",
  "claim.revoked": "Your ownership claim was revoked",
  "claim.grace_started": "Re-verification failed: fix it within 14 days to keep your verified status",
  "claim.contested": "Another seller has claimed ownership of your verified domain or product",
  "seller.downgraded": "Your seller account is no longer verified",
};

async function emailsOf(db: NotifyDb, sellerId: string, roles: string[]): Promise<Array<{ id: string; email: string }>> {
  const members = await db.sellerMember.findMany({ where: { sellerId, role: { in: roles } }, select: { userId: true } });
  if (!members.length) return [];
  return db.user.findMany({ where: { id: { in: members.map((m) => m.userId) }, status: "ACTIVE", emailVerifiedAt: { not: null } }, select: { id: true, email: true } });
}

/**
 * notifications claim.* / seller.downgraded (M3 spec §7). SEL-005: `claim.contested` mails the incumbent's OWNERs the same
 * minute (through the outbox) and the claimant's OWNERs/MANAGERs. Bodies hold no claim evidence, tokens or addresses.
 */
export async function sendClaimNotice(d: { db: NotifyDb; mail: MailProvider; baseUrl?: string }, event: string, entityId: string, jobKey: string): Promise<"SENT" | "SKIPPED"> {
  const headline = HEADLINES[event];
  if (!headline) return "SKIPPED";
  const recipients: Array<{ id: string; email: string; headline: string }> = [];
  if (event === "seller.downgraded") {
    for (const u of await emailsOf(d.db, entityId, ["OWNER", "MANAGER"])) recipients.push({ ...u, headline });
  } else {
    const claim = await d.db.sellerOwnershipClaim.findUnique({ where: { id: entityId } });
    if (!claim) return "SKIPPED";
    for (const u of await emailsOf(d.db, claim.sellerId, ["OWNER", "MANAGER"])) {
      recipients.push({ ...u, headline: event === "claim.contested" ? "Your ownership claim is under review because it conflicts with an existing verified owner" : headline });
    }
    if (event === "claim.contested" && claim.conflictClaimId) {
      const inc = await d.db.sellerOwnershipClaim.findUnique({ where: { id: claim.conflictClaimId } });
      if (inc) for (const u of await emailsOf(d.db, inc.sellerId, ["OWNER"])) recipients.push({ ...u, headline });
    }
  }
  const url = `${d.baseUrl ?? appUrl()}/seller`;
  for (const r of recipients) await d.mail.send(renderMail("claim_notice", r.email, { url, headline: r.headline }), { idempotencyKey: `${jobKey}:${r.id}` });
  return recipients.length ? "SENT" : "SKIPPED";
}
