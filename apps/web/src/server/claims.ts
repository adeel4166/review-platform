import {
  CLAIM_CONFIG, EMAIL_TOKEN_TTL_MS, ClaimConflictError, ClaimConflictOfInterestError, ClaimInputError, ClaimNotFoundError, ContestWindowOpenError, DAY_MS, DomainNotAllowedError,
  DuplicateApprovalError, InvalidClaimTransitionError, SelfDecisionError, applyClaimTransition, assertAuditMetadataClean, assertHasMx, assertOwnableDomain,
  EmailNotAllowedError, assertClaimableBusinessEmail, generateChallenge, reviewRequirements, sellerNameSkeleton, type ClaimInput,systemClock } from "@rp/core";
import type { z } from "zod";
import type { Db } from "./db";
import { HttpError } from "./http";
import { recomputeSeller, requireSellerPermission } from "./sellers";
import type { Actor } from "./session";
import type { claimDecisionInput, claimSubmitInput } from "./validation";

const isP2002 = (e: unknown) => (e as { code?: string } | null)?.code === "P2002";
const lockSeller = (tx: Pick<Db, "$queryRaw">, id: string) => tx.$queryRaw`SELECT id FROM sellers WHERE id = ${id} FOR UPDATE`;

export interface SubmitDeps { now?: Date; lookupMx?: (domain: string) => Promise<readonly unknown[]> }

/** Maps core claim errors to stable HTTP errors. Self-decision reuses SelfDecisionError (spec §5.10). */
export function mapClaimError(e: unknown): never {
  if (e instanceof ClaimNotFoundError) throw new HttpError(404, "not_found", "Claim not found");
  if (e instanceof SelfDecisionError) throw new HttpError(403, "self_decision_forbidden", "You cannot decide your own claim");
  if (e instanceof ClaimConflictOfInterestError) throw new HttpError(403, "CONFLICT_OF_INTEREST", "You are a member of a seller involved in this claim");
  if (e instanceof InvalidClaimTransitionError) throw new HttpError(409, "invalid_transition", "That action is not allowed in the claim's current state");
  if (e instanceof DuplicateApprovalError) throw new HttpError(409, "duplicate_approval", "You have already approved this claim");
  if (e instanceof ContestWindowOpenError) throw new HttpError(409, "contest_window_open", "The incumbent's response window is still open");
  if (e instanceof ClaimConflictError) throw new HttpError(409, "domain_already_verified", "The domain or product is verified for another seller");
  if (e instanceof ClaimInputError) throw new HttpError(409, e.message, "The claim is not ready for that action");
  throw e;
}

/** POST /api/sellers/:sellerId/claims (spec §5.1). */
export async function submitClaim(db: Db, actor: Actor, sellerId: string, input: z.infer<typeof claimSubmitInput>, deps: SubmitDeps = {}) {
  const now = deps.now ?? systemClock.now();
  await requireSellerPermission(db, actor, "seller.claim.submit", sellerId, now);
  const user = await db.user.findUnique({ where: { id: actor.id }, select: { emailVerifiedAt: true } });
  if (!user?.emailVerifiedAt) throw new HttpError(403, "email_unverified", "Verify your email address first");

  // SEL-002: domain policy (PSL-style registrable check, shared-host / free-mail deny-lists) before anything is stored.
  let domain: string | null = null;
  let roleAddress = false;
  try {
    if (input.method === "BUSINESS_EMAIL_DOMAIN") {
      // m3b-spec 4.1: PSL + deny-list policy; the mail domain must itself be the registrable domain (no subdomain mailboxes).
      const e = assertClaimableBusinessEmail(input.businessEmail!, input.domain);
      domain = e.domain;
      roleAddress = e.localClass === "role";
      if (deps.lookupMx) await assertHasMx(domain, deps.lookupMx);
    } else if (input.domain) domain = assertOwnableDomain(input.domain, "claim").domain;
  } catch (e) {
    if (e instanceof DomainNotAllowedError) throw new HttpError(422, "domain_not_allowed", `domain_not_allowed:${e.reason}`);
    if (e instanceof EmailNotAllowedError) throw new HttpError(422, "email_not_allowed", `email_not_allowed:${e.reason}`);
    throw e;
  }
  const businessEmail = input.method === "BUSINESS_EMAIL_DOMAIN" ? input.businessEmail!.trim() : null;

  try {
    return await db.$transaction(async (tx) => {
      await lockSeller(tx, sellerId);
      const seller = await tx.seller.findUnique({ where: { id: sellerId }, select: { status: true, closedAt: true, nameSkeleton: true, nameReviewFlag: true } });
      if (!seller || seller.closedAt) throw new HttpError(404, "not_found", "Not found");
      if (seller.status === "SUSPENDED" || seller.status === "CLOSED") throw new HttpError(403, "SELLER_SUSPENDED", "This seller cannot submit claims");
      const [open, today] = await Promise.all([
        tx.sellerOwnershipClaim.count({ where: { sellerId, status: { in: ["PENDING", "CONTESTED"] } } }),
        tx.sellerOwnershipClaim.count({ where: { sellerId, createdAt: { gt: new Date(now.getTime() - DAY_MS) } } }),
      ]);
      if (open >= CLAIM_CONFIG.maxActivePerSeller || today >= CLAIM_CONFIG.maxSubmissionsPerSellerPerDay) throw new HttpError(429, "rate_limited", "Too many claims", { "Retry-After": "3600" });

      if (businessEmail) {
        // m3b-spec 4.2: the platform must not become a mail cannon. Per user 5/day, per target domain 3 per 7 days (all sellers), one open claim per address.
        const [byUser, byDomain, sameAddress] = await Promise.all([
          tx.sellerOwnershipClaim.count({ where: { submittedById: actor.id, method: "BUSINESS_EMAIL_DOMAIN", createdAt: { gt: new Date(now.getTime() - DAY_MS) } } }),
          tx.sellerOwnershipClaim.count({ where: { domain, method: "BUSINESS_EMAIL_DOMAIN", createdAt: { gt: new Date(now.getTime() - 7 * DAY_MS) } } }),
          tx.sellerOwnershipClaim.count({ where: { businessEmail, status: { in: ["PENDING", "CONTESTED"] } } }),
        ]);
        if (byUser >= 5 || byDomain >= 3) throw new HttpError(429, "rate_limited", "Too many business e-mail claims", { "Retry-After": "3600" });
        if (sameAddress > 0) throw new HttpError(409, "claim_exists", "A claim for this address is already open");
      }

      let reviewCount = 0;
      let productSellerId: string | null = null;
      if (input.scope === "PRODUCT") {
        const p = await tx.product.findUnique({ where: { id: input.productId! }, select: { status: true, reviewCount: true, sellerId: true } });
        if (seller.status !== "VERIFIED") throw new HttpError(403, "seller_not_verified", "Verify the seller before claiming products");
        if (!p || p.status !== "ACTIVE") throw new HttpError(404, "not_found", "Product not found");
        reviewCount = p.reviewCount;
        productSellerId = p.sellerId;
      } else {
        const brand = await tx.product.findMany({ where: { status: "ACTIVE", brandName: { not: null } }, select: { brandName: true, reviewCount: true }, take: 5000 });
        reviewCount = brand.filter((b) => sellerNameSkeleton(b.brandName ?? "") === seller.nameSkeleton).reduce((n, b) => n + b.reviewCount, 0);
      }

      const activeKey = `${sellerId}|${input.scope}|${domain ?? input.productId ?? input.method}`;
      if (await tx.sellerOwnershipClaim.findFirst({ where: { activeKey }, select: { id: true } })) throw new HttpError(409, "claim_exists", "A claim for this target is already open");

      // SEL-003 conflict scan: never refuses (the domain may have changed hands), it forces review + a contest later.
      const incumbent = domain
        ? await tx.sellerOwnershipClaim.findFirst({ where: { domain, status: "VERIFIED", sellerId: { not: sellerId } }, select: { id: true } })
        : input.productId
          ? await tx.sellerOwnershipClaim.findFirst({ where: { productId: input.productId, status: "VERIFIED", sellerId: { not: sellerId } }, select: { id: true } })
          : null;
      const rival = incumbent ?? (domain ? await tx.sellerOwnershipClaim.findFirst({ where: { domain, status: { in: ["PENDING", "CONTESTED"] }, sellerId: { not: sellerId } }, select: { id: true } }) : null);
      const sameBrand = await tx.seller.findFirst({ where: { status: "VERIFIED", nameSkeleton: seller.nameSkeleton, id: { not: sellerId } }, select: { id: true } });
      const req: ReturnType<typeof reviewRequirements> = reviewRequirements({
        scope: input.scope, method: input.method, brandHasExistingClaim: !!(rival || sameBrand || (productSellerId && productSellerId !== sellerId)),
        reviewCount, nameReviewFlag: seller.nameReviewFlag,
      });

      // Role addresses (info@, sales@ ...) are often shared or forwarded: never auto-approved (C4).
      if (roleAddress && !req.requiresHumanReview) { req.requiresHumanReview = true; req.reason = "ROLE_ADDRESS"; }
      const isEmail = input.method === "BUSINESS_EMAIL_DOMAIN";
      const needsChallenge = input.method === "DNS_TXT" || input.method === "META_TAG" || input.method === "MARKETPLACE";
      const challengeExpiresAt = needsChallenge || isEmail ? new Date(now.getTime() + CLAIM_CONFIG.challengeTtlMs) : null;
      const challengeValue = needsChallenge ? generateChallenge() : null;
      const claim = await tx.sellerOwnershipClaim.create({
        data: {
          sellerId, scope: input.scope, productId: input.productId ?? null, method: input.method, domain, businessEmail, challengeValue, challengeExpiresAt,
          evidenceUrl: input.evidenceUrl ?? null, requiresHumanReview: req.requiresHumanReview, humanReviewReason: req.reason, requiredApprovals: req.requiredApprovals,
          conflictClaimId: incumbent?.id ?? null, activeKey, submittedById: actor.id,
          nextCheckAt: input.method === "DNS_TXT" || input.method === "META_TAG" || input.method === "BUSINESS_EMAIL_DOMAIN" ? now : null, // the email claim waits for the egress MX check
        },
        select: { id: true, status: true, method: true, scope: true, domain: true, challengeValue: true, challengeExpiresAt: true, requiresHumanReview: true },
      });
      await tx.outboxEvent.create({ data: { type: "claim.submitted", aggregateId: claim.id, payload: { claimId: claim.id } } });
      if (businessEmail) {
        // The token row carries the address and is bound to the submitting user. It is NOT mailed yet: the verification-egress MX check
        // must pass first (SEL-035); the core worker then emits `claim.business_email_token_requested` (applyMxObservation, C22).
        const tok = await tx.emailVerificationToken.create({
          data: { userId: actor.id, purpose: "CLAIM_BUSINESS_EMAIL", email: businessEmail, claimId: claim.id, expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS) },
          select: { id: true },
        });
        await tx.auditLog.create({ data: { actorType: "USER", actorId: actor.id, action: "claim.email_token_issued", entityType: "SellerOwnershipClaim", entityId: claim.id, metadata: { claimId: claim.id, tokenId: tok.id } } });
      }
      const meta = { claimId: claim.id, sellerId, scope: input.scope, method: input.method, requiresHumanReview: req.requiresHumanReview, requiredApprovals: req.requiredApprovals };
      assertAuditMetadataClean(meta);
      await tx.auditLog.create({ data: { actorType: "USER", actorId: actor.id, action: "claim.submitted", entityType: "SellerOwnershipClaim", entityId: claim.id, metadata: meta } });
      await recomputeSeller(tx, sellerId, { id: actor.id }, now);
      return {
        id: claim.id, status: claim.status, method: claim.method, scope: claim.scope, domain: claim.domain, requiresHumanReview: claim.requiresHumanReview,
        challengeExpiresAt: claim.challengeExpiresAt,
        // Shown only to the submitter: how to publish the proof.
        instructions: claim.challengeValue && claim.domain
          ? claim.method === "DNS_TXT"
            ? { type: "TXT", host: `_rp-verify.${claim.domain}`, value: `rp-verify=${claim.challengeValue}` }
            : { type: "META", tag: `<meta name="rp-verify" content="${claim.challengeValue}">` }
          : claim.challengeValue ? { type: "MARKETPLACE", value: `rp-verify=${claim.challengeValue}` } : null,
      };
    });
  } catch (e) {
    if (isP2002(e)) throw new HttpError(409, "claim_exists", "A claim for this target is already open");
    throw e;
  }
}

/** C10: only an OWNER/MANAGER of the claiming seller (derived from the claim row, not the request) can withdraw. */
export async function withdrawClaim(db: Db, actor: Actor, claimId: string, now = systemClock.now()) {
  const c = await db.sellerOwnershipClaim.findUnique({ where: { id: claimId }, select: { sellerId: true } });
  if (!c) throw new HttpError(404, "not_found", "Claim not found");
  await requireSellerPermission(db, actor, "seller.claim.submit", c.sellerId, now);
  try {
    const r = await applyClaimTransition(db, claimId, { action: "WITHDRAW" }, { id: actor.id, type: "USER" }, now);
    return { id: r.claimId, status: r.status };
  } catch (e) {
    return mapClaimError(e);
  }
}

const QUEUE_SELECT = {
  id: true, sellerId: true, scope: true, productId: true, method: true, status: true, domain: true, requiresHumanReview: true, humanReviewReason: true,
  requiredApprovals: true, conflictClaimId: true, contestResponseDueAt: true, lastCheckOutcome: true, lastCheckAt: true, spotCheckRequired: true, createdAt: true,
} as const;

/** Staff queue (spec §5.9): a filtered list over claims. ADMIN tier (`seller.claim.review`) is enforced by the route. */
export async function listClaimQueue(db: Db, tab: "review" | "contested" | "spot_check", page: { page: number; pageSize: number }) {
  const where =
    tab === "contested" ? { status: "CONTESTED" as const }
    : tab === "spot_check" ? { status: "VERIFIED" as const, spotCheckRequired: true, spotCheckedAt: null }
    : { status: "PENDING" as const, OR: [{ requiresHumanReview: true }, { lastCheckOutcome: "PASS" as const }] };
  const [items, total] = await Promise.all([
    db.sellerOwnershipClaim.findMany({ where, orderBy: { createdAt: "asc" }, skip: (page.page - 1) * page.pageSize, take: page.pageSize, select: { ...QUEUE_SELECT, seller: { select: { name: true } }, _count: { select: { decisions: true } } } }),
    db.sellerOwnershipClaim.count({ where }),
  ]);
  return { items, total, page: page.page, pageSize: page.pageSize };
}

export async function getClaimForStaff(db: Db, claimId: string) {
  const c = await db.sellerOwnershipClaim.findUnique({ where: { id: claimId }, select: { ...QUEUE_SELECT, evidenceUrl: true, decisions: { select: { id: true, source: true, reviewerId: true, outcome: true, reasonCode: true, createdAt: true }, orderBy: { createdAt: "asc" } } } });
  if (!c) throw new HttpError(404, "not_found", "Claim not found");
  return c;
}

/** POST /api/admin/claims/:id/decision. Self-decision is forbidden (SelfDecisionError); members of either seller get CONFLICT_OF_INTEREST. */
export async function decideClaim(db: Db, actor: Actor, claimId: string, body: z.infer<typeof claimDecisionInput>, now = systemClock.now()) {
  if (actor.role !== "admin" && actor.role !== "super_admin") throw new HttpError(403, "forbidden", "Admin access required");
  const staff = { id: actor.id, type: "STAFF" as const };
  let input: ClaimInput;
  switch (body.action) {
    case "approve": input = { action: "STAFF_APPROVE", reviewerId: actor.id, note: body.note }; break;
    case "reject":
      if (!body.reasonCode) throw new HttpError(400, "validation_error", "reasonCode is required");
      input = { action: "STAFF_REJECT", reviewerId: actor.id, reasonCode: body.reasonCode, note: body.note }; break;
    case "request_info": input = { action: "REQUEST_INFO", reviewerId: actor.id, note: body.note }; break;
    case "revoke": input = { action: "REVOKE", reviewerId: actor.id, reasonCode: "STAFF_REVOKED", note: body.note }; break;
    case "spot_check_pass": input = { action: "SPOT_CHECK", reviewerId: actor.id, pass: true }; break;
    case "spot_check_fail": input = { action: "SPOT_CHECK", reviewerId: actor.id, pass: false }; break;
  }
  try {
    const r = await applyClaimTransition(db, claimId, input, staff, now);
    return { id: r.claimId, status: r.status, contested: r.contested ?? false };
  } catch (e) {
    return mapClaimError(e);
  }
}
