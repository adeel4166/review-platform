/* eslint-disable @typescript-eslint/no-explicit-any -- structural Prisma-transaction type: core must not depend on @rp/db */
/**
 * applyClaimTransition (M3 spec §5.5): the ONLY writer of seller_ownership_claims.status. It locks the claim and the
 * involved sellers, re-reads, checks the transition table and writes claim + decision + seller recompute + audit + outbox
 * in one transaction. Used by the staff API (web) and by the verification worker.
 */
import { assertAuditMetadataClean } from "./audit-metadata";
import {
  CLAIM_CONFIG, DAY_MS, assertClaimTransition, canAutoApprove, evaluateObservedTokens, isAutoMethod, isManualMethod, nextCheckAt, sampleSpotCheck,
  type CheckOutcome, type ClaimAction, type ClaimStatus,
} from "./claims";
import { SelfDecisionError } from "./moderation-service";
import { computeSellerStatus } from "./sellers";

type Tx = any;
export interface ClaimDb { $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> }
export interface ClaimActor { id: string | null; type: "USER" | "STAFF" | "SYSTEM" }

export class ClaimNotFoundError extends Error { constructor() { super("claim_not_found"); this.name = "ClaimNotFoundError"; } }
export class ClaimConflictOfInterestError extends Error { constructor() { super("CONFLICT_OF_INTEREST"); this.name = "ClaimConflictOfInterestError"; } }
export class DuplicateApprovalError extends Error { constructor() { super("duplicate_approval"); this.name = "DuplicateApprovalError"; } }
export class ContestWindowOpenError extends Error { constructor() { super("contest_window_open"); this.name = "ContestWindowOpenError"; } }
export class ClaimConflictError extends Error { constructor() { super("domain_already_verified"); this.name = "ClaimConflictError"; } }
export class ClaimInputError extends Error { constructor(m: string) { super(m); this.name = "ClaimInputError"; } }

export type ClaimInput =
  | { action: "CHECK_FAILED"; outcome: CheckOutcome }
  | { action: "CHECK_PASSED"; observed?: string[]; proofHost?: string; rand?: (max: number) => number }
  | { action: "STAFF_APPROVE"; reviewerId: string; note?: string; rand?: (max: number) => number }
  | { action: "STAFF_REJECT"; reviewerId: string; reasonCode: string; note?: string }
  | { action: "RULE_REJECT"; reasonCode: "no_mx" }
  | { action: "REQUEST_INFO"; reviewerId: string; note?: string }
  | { action: "EXPIRE_CHALLENGE" | "EXPIRE_INFO" | "WITHDRAW" | "EXPIRE_GRACE" }
  | { action: "REVERIFY_PASSED" }
  | { action: "ENTER_GRACE"; outcome?: CheckOutcome }
  | { action: "REVOKE"; reviewerId: string; reasonCode: "STAFF_REVOKED" | "SPOT_CHECK_FAILED"; note?: string }
  | { action: "SPOT_CHECK"; reviewerId: string; pass: boolean };

export interface ClaimResult { claimId: string; status: ClaimStatus; changed: boolean; contested?: boolean }

const lock = (tx: Tx, table: string, id: string) =>
  table === "sellers" ? tx.$queryRaw`SELECT id FROM sellers WHERE id = ${id} FOR UPDATE` : tx.$queryRaw`SELECT id FROM seller_ownership_claims WHERE id = ${id} FOR UPDATE`;
const isP2002 = (e: unknown) => (e as { code?: string } | null)?.code === "P2002";

function audit(tx: Tx, actor: ClaimActor, action: string, claimId: string, metadata: Record<string, string | number | boolean | null>) {
  assertAuditMetadataClean(metadata as never); // ids, enums and counters only (SEC-09c)
  return tx.auditLog.create({ data: { actorType: actor.type, actorId: actor.id, action, entityType: "SellerOwnershipClaim", entityId: claimId, metadata } });
}
const outbox = (tx: Tx, type: string, id: string, payload: Record<string, unknown>) => tx.outboxEvent.create({ data: { type, aggregateId: id, payload } });

/** SEL-011 + downgrade (§5.6): derives Seller.status from claims; emits `seller.downgraded` when VERIFIED is lost. */
export async function recomputeSellerStatus(tx: Tx, sellerId: string, actor: ClaimActor, now: Date): Promise<string> {
  const seller = await tx.seller.findUnique({ where: { id: sellerId }, select: { id: true, status: true, closedAt: true } });
  if (!seller) return "UNVERIFIED";
  const [suspension, verified, open] = await Promise.all([
    tx.enforcementAction.findFirst({ where: { subjectSellerId: sellerId, type: "SELLER_SUSPENSION", status: "ACTIVE", startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, select: { id: true } }),
    tx.sellerOwnershipClaim.findFirst({ where: { sellerId, scope: "SELLER", status: "VERIFIED" }, orderBy: { verifiedAt: "asc" }, select: { id: true, verifiedAt: true, domain: true } }),
    tx.sellerOwnershipClaim.findFirst({ where: { sellerId, scope: "SELLER", status: { in: ["PENDING", "CONTESTED"] } }, select: { id: true } }),
  ]);
  const status = computeSellerStatus({ closedAt: seller.closedAt, suspended: !!suspension, hasVerifiedSellerClaim: !!verified, hasOpenSellerClaim: !!open });
  await tx.seller.update({ where: { id: sellerId }, data: { status, verifiedClaimId: verified?.id ?? null, verifiedAt: verified?.verifiedAt ?? null, verifiedDomain: verified?.domain ?? null } });
  if (status !== seller.status) {
    await tx.auditLog.create({ data: { actorType: actor.type, actorId: actor.id, action: "seller.status_changed", entityType: "Seller", entityId: sellerId, metadata: { sellerId, from: seller.status, to: status } } });
    if (seller.status === "VERIFIED") await outbox(tx, "seller.downgraded", sellerId, { sellerId, at: now.toISOString() });
  }
  return status;
}

const ENDED = (status: ClaimStatus, now: Date, endReason: string | null) => ({
  status, endedAt: now, endReason, activeKey: null, verifiedDomainKey: null, nextCheckAt: null, graceEndsAt: null, reverifyFailingSince: null,
});

export async function applyClaimTransition(db: ClaimDb, claimId: string, input: ClaimInput, actor: ClaimActor, now: Date = new Date()): Promise<ClaimResult> {
  return db.$transaction(async (tx: Tx): Promise<ClaimResult> => {
    // Lock order: claim, then sellers by id. Re-read everything after locking.
    await lock(tx, "claims", claimId);
    const claim = await tx.sellerOwnershipClaim.findUnique({ where: { id: claimId } });
    if (!claim) throw new ClaimNotFoundError();
    const conflict = claim.conflictClaimId ? await tx.sellerOwnershipClaim.findUnique({ where: { id: claim.conflictClaimId } }) : null;
    for (const sid of [...new Set([claim.sellerId, conflict?.sellerId].filter(Boolean) as string[])].sort()) await lock(tx, "sellers", sid);
    assertClaimTransition(claim.status, input.action); // SEL-014: no row change, no audit row on a bad transition

    const res = (status: ClaimStatus, changed = true, extra: Partial<ClaimResult> = {}): ClaimResult => ({ claimId, status, changed, ...extra });
    const decision = (source: "RULE" | "STAFF", outcome: string, reviewerId: string | null, reasonCode?: string, note?: string) =>
      tx.sellerClaimDecision.create({ data: { claimId, source, reviewerId, outcome, reasonCode: reasonCode ?? null, note: note ?? null } });

    /** Re-scans NOW for another seller's VERIFIED claim on the same domain or product (SEL-003). */
    const findIncumbent = async () => {
      if (claim.domain) {
        const c = await tx.sellerOwnershipClaim.findFirst({ where: { domain: claim.domain, status: "VERIFIED", sellerId: { not: claim.sellerId }, id: { not: claim.id } } });
        if (c) return c;
      }
      if (claim.productId) {
        const product = await tx.product.findUnique({ where: { id: claim.productId }, select: { sellerId: true } });
        if (product?.sellerId && product.sellerId !== claim.sellerId) {
          return (await tx.sellerOwnershipClaim.findFirst({ where: { productId: claim.productId, status: "VERIFIED", sellerId: product.sellerId } })) ?? { id: null, sellerId: product.sellerId };
        }
      }
      return null;
    };

    const contest = async (incumbent: { id: string | null }) => {
      if (!incumbent.id) throw new ClaimConflictError(); // product owned by another seller with no claim row: staff must resolve it
      await tx.sellerOwnershipClaim.update({
        where: { id: claimId },
        data: { status: "CONTESTED", conflictClaimId: incumbent.id, requiredApprovals: 2, requiresHumanReview: true, humanReviewReason: "CONFLICT", contestResponseDueAt: new Date(now.getTime() + CLAIM_CONFIG.contestResponseMs), nextCheckAt: null, lastCheckOutcome: input.action === "CHECK_PASSED" ? "PASS" : claim.lastCheckOutcome, lastCheckAt: input.action === "CHECK_PASSED" ? now : claim.lastCheckAt },
      });
      await outbox(tx, "claim.contested", claimId, { claimId }); // mails the incumbent's OWNERs and the claimant (SEL-005)
      await audit(tx, actor, "claim.contested", claimId, { claimId, sellerId: claim.sellerId, conflictClaimId: incumbent.id });
      await recomputeSellerStatus(tx, claim.sellerId, actor, now);
      return res("CONTESTED", true, { contested: true });
    };

    const verify = async (source: "RULE" | "STAFF", reviewerId: string | null, rand?: (m: number) => number) => {
      const spot = source === "RULE" ? sampleSpotCheck(claim.method, rand) : false;
      try {
        await tx.sellerOwnershipClaim.update({
          where: { id: claimId },
          data: {
            status: "VERIFIED", verifiedAt: now, verifiedUntil: new Date(now.getTime() + CLAIM_CONFIG.validityMs), verifiedDomainKey: claim.domain ?? null,
            spotCheckRequired: spot, nextCheckAt: null, contestResponseDueAt: null, lastCheckOutcome: claim.lastCheckOutcome, lastCheckAt: claim.lastCheckAt ?? now,
          },
        });
      } catch (e) {
        if (isP2002(e)) throw new ClaimConflictError(); // unique verifiedDomainKey: never two sellers verified on one domain
        throw e;
      }
      if (claim.scope === "PRODUCT" && claim.productId) await tx.product.update({ where: { id: claim.productId }, data: { sellerId: claim.sellerId } });
      await decision(source, "APPROVE", reviewerId);
      await recomputeSellerStatus(tx, claim.sellerId, actor, now);
      await outbox(tx, "claim.verified", claimId, { claimId });
      await audit(tx, actor, "claim.verified", claimId, { claimId, sellerId: claim.sellerId, method: claim.method, source });
      return res("VERIFIED");
    };

    const end = async (status: ClaimStatus, reason: string | null, event: string, auditAction: string) => {
      await tx.sellerOwnershipClaim.update({ where: { id: claimId }, data: ENDED(status, now, reason) });
      if (claim.scope === "PRODUCT" && claim.productId && claim.status === "VERIFIED") await tx.product.update({ where: { id: claim.productId }, data: { sellerId: null } });
      await recomputeSellerStatus(tx, claim.sellerId, actor, now);
      await outbox(tx, event, claimId, { claimId });
      await audit(tx, actor, auditAction, claimId, { claimId, sellerId: claim.sellerId, from: claim.status, reason });
      return res(status);
    };

    switch (input.action) {
      case "CHECK_FAILED": {
        if (claim.challengeExpiresAt && claim.challengeExpiresAt <= now) return res("PENDING", false);
        await tx.sellerOwnershipClaim.update({ where: { id: claimId }, data: { checkAttempts: { increment: 1 }, lastCheckAt: now, lastCheckOutcome: input.outcome, nextCheckAt: nextCheckAt(claim.checkAttempts, now, claim.challengeExpiresAt) } });
        await audit(tx, actor, "claim.check_failed", claimId, { claimId, outcome: input.outcome, attempt: claim.checkAttempts + 1 });
        return res("PENDING");
      }
      case "CHECK_PASSED": {
        if (!isAutoMethod(claim.method)) return res("PENDING", false); // DOCUMENT/MARKETPLACE are never machine-passed (SEL-004)
        if (input.observed && evaluateObservedTokens(claim, input.observed, now) !== "PASS") throw new ClaimInputError("challenge_mismatch");
        if (!input.observed && (!claim.challengeExpiresAt || claim.challengeExpiresAt <= now) && claim.method !== "BUSINESS_EMAIL_DOMAIN") throw new ClaimInputError("challenge_expired");
        const incumbent = await findIncumbent();
        if (incumbent) return contest(incumbent); // C5: valid evidence + a VERIFIED conflicting claim is never auto-approved
        const [member, user, seller] = await Promise.all([
          tx.sellerMember.findUnique({ where: { sellerId_userId: { sellerId: claim.sellerId, userId: claim.submittedById } }, select: { role: true } }),
          tx.user.findUnique({ where: { id: claim.submittedById }, select: { emailVerifiedAt: true, status: true } }),
          tx.seller.findUnique({ where: { id: claim.sellerId }, select: { status: true, closedAt: true } }),
        ]);
        const ok = canAutoApprove({
          method: claim.method, scope: claim.scope, outcome: "PASS", requiresHumanReview: claim.requiresHumanReview, hasConflict: false,
          claimantIsOwnerOrManager: member?.role === "OWNER" || member?.role === "MANAGER", claimantEmailVerified: !!user?.emailVerifiedAt && user.status === "ACTIVE",
          sellerBlocked: !seller || seller.closedAt != null || seller.status === "SUSPENDED" || seller.status === "CLOSED", challengeUnexpired: true,
        });
        if (!ok) { // C4: stays PENDING, shows in the queue as "evidence passed"
          await tx.sellerOwnershipClaim.update({ where: { id: claimId }, data: { lastCheckOutcome: "PASS", lastCheckAt: now, nextCheckAt: null } });
          await audit(tx, actor, "claim.check_passed", claimId, { claimId, autoApproved: false, proofHost: input.proofHost ?? null });
          return res("PENDING");
        }
        await tx.sellerOwnershipClaim.update({ where: { id: claimId }, data: { lastCheckOutcome: "PASS", lastCheckAt: now } });
        if (input.proofHost) await audit(tx, actor, "claim.proof_host", claimId, { claimId, proofHost: input.proofHost });
        claim.lastCheckOutcome = "PASS"; claim.lastCheckAt = now;
        return verify("RULE", null, input.rand);
      }
      case "STAFF_APPROVE": {
        if (input.reviewerId === claim.submittedById) throw new SelfDecisionError();
        const members = await tx.sellerMember.findMany({ where: { userId: input.reviewerId, sellerId: { in: [claim.sellerId, ...(conflict ? [conflict.sellerId] : [])] } }, select: { sellerId: true } });
        if (members.length > 0) throw new ClaimConflictOfInterestError();
        if (isAutoMethod(claim.method) && claim.lastCheckOutcome !== "PASS") throw new ClaimInputError("evidence_not_passed");
        // T-05: re-check the state the auto-approval path checks. Evidence and membership may have changed since submission.
        const [seller, member] = await Promise.all([
          tx.seller.findUnique({ where: { id: claim.sellerId }, select: { status: true, closedAt: true } }),
          tx.sellerMember.findUnique({ where: { sellerId_userId: { sellerId: claim.sellerId, userId: claim.submittedById } }, select: { role: true } }),
        ]);
        if (!seller || seller.closedAt != null || seller.status === "SUSPENDED" || seller.status === "CLOSED") throw new ClaimInputError("seller_blocked");
        if (member?.role !== "OWNER" && member?.role !== "MANAGER") throw new ClaimInputError("claimant_not_owner_or_manager");
        if (claim.status === "PENDING") {
          const incumbent = await findIncumbent();
          if (incumbent) return contest(incumbent); // C5 on first approval of a manual claim: no approval is counted yet
        } else if (claim.contestResponseDueAt && claim.contestResponseDueAt > now) {
          throw new ContestWindowOpenError();
        }
        if (await tx.sellerClaimDecision.findFirst({ where: { claimId, source: "STAFF", outcome: "APPROVE", reviewerId: input.reviewerId } })) throw new DuplicateApprovalError();
        const approvals = (await tx.sellerClaimDecision.count({ where: { claimId, source: "STAFF", outcome: "APPROVE" } })) + 1;
        if (approvals < claim.requiredApprovals) {
          await decision("STAFF", "APPROVE", input.reviewerId, undefined, input.note);
          await audit(tx, actor, "claim.approval_recorded", claimId, { claimId, approvals, required: claim.requiredApprovals });
          return res(claim.status);
        }
        // Final approval only: a PASS older than 24 h (e.g. a CONTESTED claim waiting out the response window) is not trusted.
        if (isAutoMethod(claim.method) && claim.method !== "BUSINESS_EMAIL_DOMAIN" && (!claim.lastCheckAt || claim.lastCheckAt.getTime() < now.getTime() - DAY_MS)) throw new ClaimInputError("evidence_stale");
        if (claim.status === "CONTESTED" && conflict && conflict.status === "VERIFIED") {
          await tx.sellerOwnershipClaim.update({ where: { id: conflict.id }, data: ENDED("REVOKED", now, "CONTEST_LOST") });
          if (conflict.scope === "PRODUCT" && conflict.productId) await tx.product.update({ where: { id: conflict.productId }, data: { sellerId: null } });
          await tx.sellerClaimDecision.create({ data: { claimId: conflict.id, source: "STAFF", reviewerId: input.reviewerId, outcome: "REVOKE", reasonCode: "CONTEST_LOST" } });
          await recomputeSellerStatus(tx, conflict.sellerId, actor, now);
          await outbox(tx, "claim.revoked", conflict.id, { claimId: conflict.id });
          await audit(tx, actor, "claim.revoked", conflict.id, { claimId: conflict.id, reason: "CONTEST_LOST", byClaimId: claimId });
        }
        return verify("STAFF", input.reviewerId);
      }
      case "STAFF_REJECT": {
        if (input.reviewerId === claim.submittedById) throw new SelfDecisionError();
        if (!input.reasonCode) throw new ClaimInputError("reason_required");
        const members = await tx.sellerMember.findMany({ where: { userId: input.reviewerId, sellerId: { in: [claim.sellerId, ...(conflict ? [conflict.sellerId] : [])] } }, select: { sellerId: true } });
        if (members.length > 0) throw new ClaimConflictOfInterestError();
        await decision("STAFF", "REJECT", input.reviewerId, input.reasonCode, input.note);
        return end("REJECTED", null, "claim.rejected", "claim.rejected");
      }
      case "RULE_REJECT": {
        // C20 (m3b-spec 4.3): a RULE decision, no reviewer. Any unmailed or unused email token dies with the claim.
        await decision("RULE", "REJECT", null, input.reasonCode);
        await tx.emailVerificationToken.updateMany({ where: { claimId, consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: now } });
        return end("REJECTED", null, "claim.rejected", "claim.rejected");
      }
      case "REQUEST_INFO": {
        if (input.reviewerId === claim.submittedById) throw new SelfDecisionError();
        await tx.sellerOwnershipClaim.update({ where: { id: claimId }, data: { infoRequestedAt: now } });
        await decision("STAFF", "REQUEST_INFO", input.reviewerId, undefined, input.note);
        await audit(tx, actor, "claim.info_requested", claimId, { claimId });
        return res("PENDING");
      }
      case "EXPIRE_CHALLENGE": {
        const due = isManualMethod(claim.method) ? false : !!claim.challengeExpiresAt && claim.challengeExpiresAt <= now && claim.lastCheckOutcome !== "PASS";
        const dueBizEmail = claim.method === "BUSINESS_EMAIL_DOMAIN" && !!claim.challengeExpiresAt && claim.challengeExpiresAt <= now && claim.lastCheckOutcome !== "PASS";
        if (!due && !dueBizEmail) return res("PENDING", false);
        return end("EXPIRED", "CHALLENGE_TIMEOUT", "claim.expired", "claim.expired");
      }
      case "EXPIRE_INFO": {
        if (!claim.infoRequestedAt || claim.infoRequestedAt.getTime() + CLAIM_CONFIG.infoTimeoutMs > now.getTime()) return res("PENDING", false);
        return end("EXPIRED", "INFO_TIMEOUT", "claim.expired", "claim.expired");
      }
      case "WITHDRAW": {
        await tx.sellerOwnershipClaim.update({ where: { id: claimId }, data: ENDED("WITHDRAWN", now, null) });
        await recomputeSellerStatus(tx, claim.sellerId, actor, now);
        await audit(tx, actor, "claim.withdrawn", claimId, { claimId, sellerId: claim.sellerId });
        return res("WITHDRAWN");
      }
      case "REVERIFY_PASSED": {
        const until = new Date(now.getTime() + CLAIM_CONFIG.validityMs);
        await tx.sellerOwnershipClaim.update({
          where: { id: claimId },
          data: { lastCheckAt: now, lastCheckOutcome: "PASS", verifiedUntil: claim.verifiedUntil && claim.verifiedUntil > until ? claim.verifiedUntil : until, graceEndsAt: null, reverifyFailingSince: null, renewalRequestedAt: null },
        });
        if (claim.graceEndsAt) await audit(tx, actor, "claim.renewed", claimId, { claimId, method: claim.method });
        return res("VERIFIED");
      }
      case "ENTER_GRACE": {
        if (claim.graceEndsAt) { // already in grace: only record the latest outcome
          await tx.sellerOwnershipClaim.update({ where: { id: claimId }, data: { lastCheckAt: now, lastCheckOutcome: input.outcome ?? claim.lastCheckOutcome } });
          return res("VERIFIED", false);
        }
        await tx.sellerOwnershipClaim.update({ where: { id: claimId }, data: { reverifyFailingSince: now, graceEndsAt: new Date(now.getTime() + CLAIM_CONFIG.graceMs), lastCheckAt: now, lastCheckOutcome: input.outcome ?? claim.lastCheckOutcome } });
        await outbox(tx, "claim.grace_started", claimId, { claimId });
        await audit(tx, actor, "claim.grace_started", claimId, { claimId, method: claim.method });
        return res("VERIFIED");
      }
      case "EXPIRE_GRACE": {
        if (!claim.graceEndsAt || claim.graceEndsAt > now || (isAutoMethod(claim.method) && claim.method !== "BUSINESS_EMAIL_DOMAIN" && claim.lastCheckOutcome === "PASS")) return res("VERIFIED", false);
        return end("EXPIRED", claim.method === "DNS_TXT" || claim.method === "META_TAG" ? "REVERIFY_FAILED" : "VALIDITY_ENDED", "claim.expired", "claim.expired");
      }
      case "REVOKE": {
        if (input.reviewerId === claim.submittedById) throw new SelfDecisionError();
        await decision("STAFF", "REVOKE", input.reviewerId, input.reasonCode, input.note);
        return end("REVOKED", input.reasonCode, "claim.revoked", "claim.revoked");
      }
      case "SPOT_CHECK": {
        if (!claim.spotCheckRequired || claim.spotCheckedAt) throw new ClaimInputError("no_spot_check_pending");
        if (input.reviewerId === claim.submittedById) throw new SelfDecisionError();
        if (!input.pass) {
          await decision("STAFF", "SPOT_CHECK_FAIL", input.reviewerId, "SPOT_CHECK_FAILED");
          return end("REVOKED", "SPOT_CHECK_FAILED", "claim.revoked", "claim.revoked");
        }
        await tx.sellerOwnershipClaim.update({ where: { id: claimId }, data: { spotCheckedAt: now } });
        await decision("STAFF", "SPOT_CHECK_PASS", input.reviewerId);
        await audit(tx, actor, "claim.spot_checked", claimId, { claimId, pass: true });
        return res("VERIFIED");
      }
    }
  });
}

export type { ClaimAction };
