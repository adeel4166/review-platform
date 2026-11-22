/** BUSINESS_EMAIL_DOMAIN token consumption and denial (m3b-spec 4.4, C21). */
import { applyClaimTransition, assertAuditMetadataClean, hashEmailToken, systemClock } from "@rp/core";
import type { Db } from "./db";
import { HttpError } from "./http";
import { mapClaimError } from "./claims";
import { requireSellerPermission, recomputeSeller } from "./sellers";
import type { Actor } from "./session";

const invalid = () => new HttpError(400, "invalid_or_expired", "This link is invalid or has expired");
const looksLikeToken = (t: unknown): t is string => typeof t === "string" && t.length >= 20 && t.length <= 128;

/**
 * POST /api/claims/email-verify. A token is consumed ONLY by the user it was issued to, who must also be the claim's submitter,
 * signed in with a verified account and passing the seller 2FA gate. Checks 1-4 failing is a uniform 400 and the token is NOT
 * consumed, so a colleague at the brand's mailbox (or a replaying other user) can neither complete nor burn the claim. The consume
 * is one conditional update inside the same transaction as the CHECK_PASSED transition.
 */
export async function verifyBusinessEmail(db: Db, actor: Actor, rawToken: string, now = systemClock.now()) {
  if (!looksLikeToken(rawToken)) throw invalid();
  const user = await db.user.findUnique({ where: { id: actor.id }, select: { status: true, emailVerifiedAt: true } });
  if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) throw invalid();
  const tok = await db.emailVerificationToken.findUnique({
    where: { tokenHash: hashEmailToken(rawToken) },
    select: { id: true, userId: true, purpose: true, email: true, claimId: true, sentAt: true, consumedAt: true, invalidatedAt: true, expiresAt: true },
  });
  if (!tok || tok.purpose !== "CLAIM_BUSINESS_EMAIL" || !tok.sentAt || tok.consumedAt || tok.invalidatedAt || tok.expiresAt <= now || tok.userId !== actor.id || !tok.claimId) throw invalid();
  const claim = await db.sellerOwnershipClaim.findUnique({ where: { id: tok.claimId }, select: { id: true, sellerId: true, method: true, status: true, submittedById: true, businessEmail: true } });
  if (!claim || claim.method !== "BUSINESS_EMAIL_DOMAIN" || claim.status !== "PENDING" || claim.submittedById !== actor.id || claim.businessEmail !== tok.email) throw invalid();
  await requireSellerPermission(db, actor, "seller.claim.submit", claim.sellerId, now); // 2FA gate included: the guard's 403, token untouched
  try {
    return await db.$transaction(async (tx) => {
      const burned = await tx.emailVerificationToken.updateMany({ where: { id: tok.id, consumedAt: null, invalidatedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
      if (burned.count !== 1) throw invalid();
      const r = await applyClaimTransition({ $transaction: (fn) => fn(tx) }, claim.id, { action: "CHECK_PASSED" }, { id: actor.id, type: "USER" }, now);
      return { id: r.claimId, status: r.status };
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return mapClaimError(e);
  }
}

/**
 * POST /api/claims/email-verify/deny ("this wasn't me", C21). No sign-in: the mailbox controls the domain, so a valid unconsumed
 * token is a legitimate veto. The claim is rejected (RULE, mailbox_owner_denied), the seller is flagged for name review.
 */
export async function denyBusinessEmail(db: Db, rawToken: string, now = systemClock.now()) {
  if (!looksLikeToken(rawToken)) throw invalid();
  const tok = await db.emailVerificationToken.findUnique({
    where: { tokenHash: hashEmailToken(rawToken) },
    select: { id: true, purpose: true, claimId: true, sentAt: true, consumedAt: true, invalidatedAt: true, expiresAt: true },
  });
  if (!tok || tok.purpose !== "CLAIM_BUSINESS_EMAIL" || !tok.sentAt || tok.consumedAt || tok.invalidatedAt || tok.expiresAt <= now || !tok.claimId) throw invalid();
  const claimId = tok.claimId;
  return db.$transaction(async (tx) => {
    const claim = await tx.sellerOwnershipClaim.findUnique({ where: { id: claimId }, select: { id: true, sellerId: true, method: true, status: true } });
    if (!claim || claim.method !== "BUSINESS_EMAIL_DOMAIN" || claim.status !== "PENDING") throw invalid();
    const inv = await tx.emailVerificationToken.updateMany({ where: { claimId, consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: now } });
    if (inv.count < 1) throw invalid();
    await tx.sellerOwnershipClaim.update({ where: { id: claimId }, data: { status: "REJECTED", endedAt: now, activeKey: null, nextCheckAt: null } });
    await tx.sellerClaimDecision.create({ data: { claimId, source: "RULE", reviewerId: null, outcome: "REJECT", reasonCode: "mailbox_owner_denied" } });
    await tx.seller.update({ where: { id: claim.sellerId }, data: { nameReviewFlag: true } }); // SEL-010: every later claim needs a human
    const meta = { claimId, sellerId: claim.sellerId, reason: "mailbox_owner_denied" };
    assertAuditMetadataClean(meta);
    await tx.auditLog.create({ data: { actorType: "SYSTEM", actorId: null, action: "claim.rejected", entityType: "SellerOwnershipClaim", entityId: claimId, metadata: meta } });
    await tx.outboxEvent.create({ data: { type: "claim.mailbox_denied", aggregateId: claimId, payload: { claimId } } }); // alerts staff
    await recomputeSeller(tx, claim.sellerId, { id: "system", type: "SYSTEM" }, now);
    return { status: "REJECTED" as const };
  });
}
