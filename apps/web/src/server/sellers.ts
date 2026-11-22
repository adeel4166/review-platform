import {
  INVITATION_TTL_MS,
  INVITATIONS_PER_SELLER_PER_DAY,
  OPEN_INVITATIONS_PER_SELLER,
  SELLERS_PER_USER_PER_DAY,
  assertAuditMetadataClean,
  authorizeSeller,
  canInviteRole,
  computeSellerStatus,
  hashEmailToken,
  isSimilarToVerified,
  sellerNameSkeleton,
  slugify,
  type SellerMemberRole,
  type SellerPermission,systemClock } from "@rp/core";
import type { Prisma } from "@rp/db";
import type { Db } from "./db";
import { HttpError } from "./http";
import type { Actor } from "./session";
import type { z } from "zod";
import type { invitationInput, sellerCreateInput, sellerSuspendInput } from "./validation";

type Tx = Prisma.TransactionClient;
type Reader = Pick<Db, "user" | "sellerMember" | "enforcementAction"> & Partial<Pick<Db, "seller">>;

const DAY_MS = 86_400_000;
const invalidInvitation = () => new HttpError(400, "invalid_or_expired", "This invitation is invalid or has expired");
const notFound = () => new HttpError(404, "not_found", "Not found");
const isP2002 = (e: unknown) => (e as { code?: string } | null)?.code === "P2002";

/** SEC-09(c): ids, enums and counters only. Emails, tokens and names never go into audit metadata. */
function audit(tx: Tx, actor: { id: string; type?: "USER" | "STAFF" | "SYSTEM" }, action: string, entityType: string, entityId: string, metadata: Prisma.InputJsonValue) {
  assertAuditMetadataClean(metadata);
  return tx.auditLog.create({ data: { actorType: actor.type ?? "USER", actorId: actor.id, action, entityType, entityId, metadata } });
}

const activeSuspensionWhere = (sellerId: string, now: Date) => ({
  subjectSellerId: sellerId,
  type: "SELLER_SUSPENSION" as const,
  status: "ACTIVE" as const,
  startsAt: { lte: now },
  OR: [{ endsAt: null }, { endsAt: { gt: now } }],
});

/** An active SELLER_REPLY_RESTRICTION against the seller (every member) or against one user (across sellers). */
const activeReplyRestrictionWhere = (subject: { subjectSellerId: string } | { subjectUserId: string }, now: Date) => ({
  ...subject,
  type: "SELLER_REPLY_RESTRICTION" as const,
  status: "ACTIVE" as const,
  startsAt: { lte: now },
  OR: [{ endsAt: null }, { endsAt: { gt: now } }],
});

/**
 * Seller-scope guard (AZ-007, AZ-010). `sellerId` MUST come from a server-loaded resource (the path resource, the claim,
 * the invitation or the product), never from the request body. Membership and suspension are read from the database on
 * every call. Non-members get 404 (no seller enumeration); everyone else gets 403 with a stable code.
 */
export async function requireSellerPermission(
  db: Reader, actor: Actor, perm: SellerPermission, sellerId: string, now = systemClock.now(),
  /** Reply permissions only: delete waives the VERIFIED and restriction gates (m3b-spec 5.7: delete stays allowed). */
  opts: { waiveReplyGates?: boolean } = {},
) {
  const isReply = perm === "seller.reply" || perm === "seller.reply.manage";
  const [user, member, suspension, sellerRow, sellerRestriction, userRestriction] = await Promise.all([
    db.user.findUnique({ where: { id: actor.id }, select: { status: true } }),
    db.sellerMember.findUnique({ where: { sellerId_userId: { sellerId, userId: actor.id } }, select: { role: true } }),
    db.enforcementAction.findFirst({ where: activeSuspensionWhere(sellerId, now), select: { id: true } }),
    isReply && db.seller ? db.seller.findUnique({ where: { id: sellerId }, select: { status: true } }) : null,
    isReply ? db.enforcementAction.findFirst({ where: activeReplyRestrictionWhere({ subjectSellerId: sellerId }, now), select: { id: true } }) : null,
    isReply ? db.enforcementAction.findFirst({ where: activeReplyRestrictionWhere({ subjectUserId: actor.id }, now), select: { id: true } }) : null,
  ]);
  const res = authorizeSeller(
    {
      accountActive: user?.status === "ACTIVE",
      staffTier: actor.role === "admin" || actor.role === "super_admin" ? "admin" : "none",
      memberRole: (member?.role as SellerMemberRole | undefined) ?? null,
      sellerSuspended: !!suspension,
      twoFactor: { enrolled: actor.twoFactor?.enrolled === true, sessionVerified: actor.twoFactor?.verified === true },
      ...(isReply
        ? { sellerVerified: opts.waiveReplyGates ? true : sellerRow?.status === "VERIFIED", replyRestricted: opts.waiveReplyGates ? false : !!(sellerRestriction || userRestriction) }
        : {}),
    },
    perm,
  );
  if (res.allowed) return { role: (member?.role as SellerMemberRole | undefined) ?? null };
  if (res.code === "NOT_IN_SCOPE") throw notFound();
  throw new HttpError(403, res.code, "You do not have permission to do that");
}

/**
 * Derives and persists Seller.status (+ verifiedClaimId/verifiedAt/verifiedDomain) inside the caller's transaction (spec §4.2).
 * SEL-011 service invariant: VERIFIED only when a VERIFIED SELLER-scope claim of THIS seller exists.
 */
export async function recomputeSeller(tx: Tx, sellerId: string, actor: { id: string; type?: "USER" | "STAFF" | "SYSTEM" }, now = systemClock.now()) {
  const seller = await tx.seller.findUnique({ where: { id: sellerId }, select: { id: true, status: true, closedAt: true } });
  if (!seller) throw notFound();
  const [suspension, verified, open] = await Promise.all([
    tx.enforcementAction.findFirst({ where: activeSuspensionWhere(sellerId, now), select: { id: true } }),
    tx.sellerOwnershipClaim.findFirst({ where: { sellerId, scope: "SELLER", status: "VERIFIED" }, orderBy: { verifiedAt: "asc" }, select: { id: true, verifiedAt: true, domain: true } }),
    tx.sellerOwnershipClaim.findFirst({ where: { sellerId, scope: "SELLER", status: { in: ["PENDING", "CONTESTED"] } }, select: { id: true } }),
  ]);
  const status = computeSellerStatus({ closedAt: seller.closedAt, suspended: !!suspension, hasVerifiedSellerClaim: !!verified, hasOpenSellerClaim: !!open });
  await tx.seller.update({
    where: { id: sellerId },
    data: { status, verifiedClaimId: verified?.id ?? null, verifiedAt: verified?.verifiedAt ?? null, verifiedDomain: verified?.domain ?? null },
  });
  if (status !== seller.status) await audit(tx, actor, "seller.status_changed", "Seller", sellerId, { sellerId, from: seller.status, to: status });
  return status;
}

/** Creates the seller and its first OWNER atomically (spec §4.1). Caller must have passed requireVerifiedUser(). */
export async function createSeller(db: Db, actor: Actor, input: z.infer<typeof sellerCreateInput>, now = systemClock.now()) {
  const skeleton = sellerNameSkeleton(input.name);
  const slug = input.slug ?? slugify(input.name);
  if (slug.length < 2 || skeleton.length === 0) throw new HttpError(400, "validation_error", "Seller name is not usable");
  try {
    return await db.$transaction(async (tx) => {
      const recent = await tx.seller.count({ where: { createdById: actor.id, createdAt: { gt: new Date(now.getTime() - DAY_MS) } } });
      if (recent >= SELLERS_PER_USER_PER_DAY) throw new HttpError(429, "rate_limited", "Too many sellers created today", { "Retry-After": "3600" });
      // SEL-010: candidates share the first 3 skeleton characters (edit distance 1 can only break one of them for length >= 4).
      const candidates = await tx.seller.findMany({
        where: { status: "VERIFIED", OR: [{ nameSkeleton: { startsWith: skeleton.slice(0, 3) } }, { nameSkeleton: { startsWith: skeleton.slice(1, 4) } }] },
        select: { nameSkeleton: true },
        take: 200,
      });
      const nameReviewFlag = isSimilarToVerified(skeleton, candidates.map((c) => c.nameSkeleton));
      const seller = await tx.seller.create({
        data: {
          slug, name: input.name, nameSkeleton: skeleton, description: input.description, websiteUrl: input.websiteUrl,
          countryCode: input.countryCode, nameReviewFlag, createdById: actor.id,
          members: { create: { userId: actor.id, role: "OWNER" } },
        },
        select: { id: true, slug: true, status: true, nameReviewFlag: true },
      });
      await audit(tx, actor, "seller.created", "Seller", seller.id, { sellerId: seller.id, nameReviewFlag });
      await audit(tx, actor, "seller.member.added", "Seller", seller.id, { sellerId: seller.id, userId: actor.id, role: "OWNER" });
      return seller;
    });
  } catch (e) {
    if (isP2002(e)) throw new HttpError(409, "slug_taken", "That seller URL is already taken");
    throw e;
  }
}

/** Row lock so concurrent member changes serialize (spec §2.5: >= 1 OWNER). */
const lockSeller = (tx: Tx, sellerId: string) => tx.$queryRaw`SELECT id FROM sellers WHERE id = ${sellerId} FOR UPDATE`;

/** Invite: OWNER may invite MANAGER/RESPONDER, MANAGER only RESPONDER; OWNER is never grantable (SEL-007, ADR-0017). */
export async function inviteMember(db: Db, actor: Actor, sellerId: string, input: z.infer<typeof invitationInput>, now = systemClock.now()) {
  const { role: inviterRole } = await requireSellerPermission(db, actor, "seller.member.invite", sellerId, now);
  if (!inviterRole || !canInviteRole(inviterRole, input.role)) throw new HttpError(403, "FORBIDDEN_ROLE", "You cannot grant that role");
  return db.$transaction(async (tx) => {
    await lockSeller(tx, sellerId);
    const seller = await tx.seller.findUnique({ where: { id: sellerId }, select: { closedAt: true } });
    if (!seller || seller.closedAt) throw notFound();
    const [open, today] = await Promise.all([
      tx.sellerInvitation.count({ where: { sellerId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } } }),
      tx.sellerInvitation.count({ where: { sellerId, createdAt: { gt: new Date(now.getTime() - DAY_MS) } } }),
    ]);
    if (open >= OPEN_INVITATIONS_PER_SELLER || today >= INVITATIONS_PER_SELLER_PER_DAY) {
      throw new HttpError(429, "rate_limited", "Too many invitations", { "Retry-After": "3600" });
    }
    // One open invitation per (seller, email): older open ones are revoked in the same transaction.
    await tx.sellerInvitation.updateMany({
      where: { sellerId, email: input.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now, revokedById: actor.id },
    });
    const inv = await tx.sellerInvitation.create({
      data: { sellerId, email: input.email, role: input.role, invitedById: actor.id, expiresAt: new Date(now.getTime() + INVITATION_TTL_MS) },
      select: { id: true, role: true, expiresAt: true },
    });
    await tx.outboxEvent.create({ data: { type: "seller.invitation_created", aggregateId: inv.id, payload: { invitationId: inv.id } } });
    await audit(tx, actor, "seller.invitation.created", "Seller", sellerId, { sellerId, invitationId: inv.id, role: inv.role });
    // Deliberately no hint about whether the address has an account.
    return { id: inv.id, role: inv.role, expiresAt: inv.expiresAt };
  });
}

/**
 * Accept (SEL-007). The token is bound to the signed-in user's VERIFIED email and consumed by one atomic conditional update.
 * Every failure (unknown, expired, revoked, replayed, wrong account, unverified) is the same 400.
 */
export async function acceptInvitation(db: Db, actor: Actor, rawToken: string, now = systemClock.now()) {
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: { email: true, emailVerifiedAt: true, status: true } });
    if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) throw invalidInvitation();
    const row = await tx.sellerInvitation.findUnique({ where: { tokenHash: hashEmailToken(rawToken) }, select: { id: true, sellerId: true, role: true, email: true } });
    if (!row || row.email !== user.email.toLowerCase()) throw invalidInvitation();
    const claimed = await tx.sellerInvitation.updateMany({
      where: { id: row.id, email: user.email.toLowerCase(), acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now, acceptedById: actor.id },
    });
    if (claimed.count !== 1) throw invalidInvitation();
    const seller = await tx.seller.findUnique({ where: { id: row.sellerId }, select: { closedAt: true } });
    if (!seller || seller.closedAt) throw invalidInvitation();
    // Only after the token is proven valid, so this cannot be used to probe membership. Rolls the acceptance back.
    if (await tx.sellerMember.findUnique({ where: { sellerId_userId: { sellerId: row.sellerId, userId: actor.id } }, select: { userId: true } })) {
      throw new HttpError(409, "already_member", "You are already a member of this seller");
    }
    await tx.sellerMember.create({ data: { sellerId: row.sellerId, userId: actor.id, role: row.role, invitationId: row.id } });
    await audit(tx, actor, "seller.invitation.accepted", "Seller", row.sellerId, { sellerId: row.sellerId, invitationId: row.id });
    await audit(tx, actor, "seller.member.added", "Seller", row.sellerId, { sellerId: row.sellerId, userId: actor.id, role: row.role, invitationId: row.id });
    return { sellerId: row.sellerId, role: row.role };
  });
}

/** Revoke an open invitation. The seller scope is derived from the invitation row, not from the request. */
export async function revokeInvitation(db: Db, actor: Actor, invitationId: string, now = systemClock.now()) {
  const inv = await db.sellerInvitation.findUnique({ where: { id: invitationId }, select: { id: true, sellerId: true, role: true, invitedById: true } });
  if (!inv) throw notFound();
  const { role } = await requireSellerPermission(db, actor, "seller.member.invite", inv.sellerId, now);
  // MANAGER may only revoke RESPONDER invitations they sent.
  if (role === "MANAGER" && !(inv.role === "RESPONDER" && inv.invitedById === actor.id)) throw new HttpError(403, "FORBIDDEN_ROLE", "You cannot revoke this invitation");
  return db.$transaction(async (tx) => {
    const r = await tx.sellerInvitation.updateMany({ where: { id: inv.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: now, revokedById: actor.id } });
    if (r.count !== 1) throw notFound();
    await audit(tx, actor, "seller.invitation.revoked", "Seller", inv.sellerId, { sellerId: inv.sellerId, invitationId: inv.id });
    return { id: inv.id, status: "revoked" as const };
  });
}

/**
 * Remove a member, or leave (target = actor). OWNER may remove anyone; any member may leave. The last OWNER can neither be
 * removed nor leave (409 last_owner), checked under a row lock so two concurrent removals cannot both succeed.
 */
/** T8 (m3b-spec 3.2): an open ownership change whose initiator or target leaves, is removed or changes role is cancelled in the same transaction. */
export async function cancelOpenTransfersFor(tx: Tx, sellerId: string, userId: string, now: Date) {
  const open = await tx.sellerOwnershipTransfer.findMany({
    where: { sellerId, status: { in: ["PENDING", "ACCEPTED"] }, OR: [{ initiatorId: userId }, { targetUserId: userId }] },
    select: { id: true },
  });
  for (const t of open) {
    await tx.sellerOwnershipTransfer.update({ where: { id: t.id }, data: { status: "CANCELLED", endReason: "CANCELLED_MEMBERSHIP_CHANGED", endedAt: now, openKey: null } });
    await tx.outboxEvent.create({ data: { type: "seller.ownership_transfer_cancelled", aggregateId: t.id, payload: { transferId: t.id, status: "CANCELLED" } } });
    await tx.auditLog.create({ data: { actorType: "SYSTEM", actorId: null, action: "seller.ownership_transfer.cancelled", entityType: "SellerOwnershipTransfer", entityId: t.id, metadata: { sellerId, endReason: "CANCELLED_MEMBERSHIP_CHANGED" } } });
  }
}

export async function removeMember(db: Db, actor: Actor, sellerId: string, targetUserId: string, now = systemClock.now()) {
  const leaving = targetUserId === actor.id;
  if (leaving) {
    const m = await db.sellerMember.findUnique({ where: { sellerId_userId: { sellerId, userId: actor.id } }, select: { role: true } });
    if (!m) throw notFound();
  } else {
    await requireSellerPermission(db, actor, "seller.member.manage", sellerId, now);
  }
  return db.$transaction(async (tx) => {
    await lockSeller(tx, sellerId);
    const target = await tx.sellerMember.findUnique({ where: { sellerId_userId: { sellerId, userId: targetUserId } }, select: { role: true } });
    if (!target) throw notFound();
    // m3b-spec 3.1: an OWNER cannot remove another OWNER directly (the 72 h REMOVE_OWNER flow applies); leaving stays immediate.
    if (target.role === "OWNER" && !leaving) throw new HttpError(409, "use_ownership_change", "Use an ownership change to remove an owner");
    if (target.role === "OWNER" && (await tx.sellerMember.count({ where: { sellerId, role: "OWNER" } })) <= 1) {
      throw new HttpError(409, "last_owner", "A seller must keep at least one owner");
    }
    await tx.sellerMember.delete({ where: { sellerId_userId: { sellerId, userId: targetUserId } } });
    await cancelOpenTransfersFor(tx, sellerId, targetUserId, now);
    await audit(tx, actor, "seller.member.removed", "Seller", sellerId, { sellerId, userId: targetUserId, role: target.role, leaving });
    return { sellerId, userId: targetUserId, status: "removed" as const };
  });
}

/** T-04 (F-04, ADR-0003): a staff actor who is a member of the seller must not enforce on it. */
async function assertNoConflictOfInterest(tx: Tx, sellerId: string, actorId: string) {
  const m = await tx.sellerMember.findUnique({ where: { sellerId_userId: { sellerId, userId: actorId } }, select: { userId: true } });
  if (m) throw new HttpError(403, "CONFLICT_OF_INTEREST", "You are a member of this seller");
}

/** AZ-007: staff suspension removes every seller permission for every member (enforced in requireSellerPermission). T-04: COI guard. */
export async function suspendSeller(db: Db, actor: Actor, sellerId: string, input: z.infer<typeof sellerSuspendInput>, now = systemClock.now()) {
  if (actor.role !== "admin" && actor.role !== "super_admin") throw new HttpError(403, "forbidden", "Admin access required");
  if (input.endsAt && input.endsAt <= now) throw new HttpError(400, "validation_error", "endsAt must be in the future");
  return db.$transaction(async (tx) => {
    await lockSeller(tx, sellerId);
    if (!(await tx.seller.findUnique({ where: { id: sellerId }, select: { id: true } }))) throw notFound();
    await assertNoConflictOfInterest(tx, sellerId, actor.id);
    const a = await tx.enforcementAction.create({
      data: { type: "SELLER_SUSPENSION", subjectSellerId: sellerId, reasonCode: input.reasonCode, publicReason: input.publicReason, issuedById: actor.id, startsAt: now, endsAt: input.endsAt ?? null },
      select: { id: true },
    });
    await audit(tx, { id: actor.id, type: "STAFF" }, "enforcement.issued", "Seller", sellerId, { sellerId, enforcementId: a.id, type: "SELLER_SUSPENSION", reasonCode: input.reasonCode });
    const status = await recomputeSeller(tx, sellerId, { id: actor.id, type: "STAFF" }, now);
    return { enforcementId: a.id, status };
  });
}

/** T-04: COI guard plus a second staff actor: whoever issued an active suspension cannot lift it (403 second_actor_required). */
export async function unsuspendSeller(db: Db, actor: Actor, sellerId: string, now = systemClock.now()) {
  if (actor.role !== "admin" && actor.role !== "super_admin") throw new HttpError(403, "forbidden", "Admin access required");
  return db.$transaction(async (tx) => {
    await lockSeller(tx, sellerId);
    await assertNoConflictOfInterest(tx, sellerId, actor.id);
    const active = await tx.enforcementAction.findMany({ where: { subjectSellerId: sellerId, type: "SELLER_SUSPENSION", status: "ACTIVE" }, select: { issuedById: true } });
    if (active.some((a) => a.issuedById === actor.id)) throw new HttpError(403, "second_actor_required", "A different staff member must lift this suspension");
    const r = await tx.enforcementAction.updateMany({
      where: { subjectSellerId: sellerId, type: "SELLER_SUSPENSION", status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: now, revokedById: actor.id },
    });
    if (r.count === 0) throw notFound();
    await audit(tx, { id: actor.id, type: "STAFF" }, "enforcement.revoked", "Seller", sellerId, { sellerId, type: "SELLER_SUSPENSION", count: r.count });
    const status = await recomputeSeller(tx, sellerId, { id: actor.id, type: "STAFF" }, now);
    return { status };
  });
}
