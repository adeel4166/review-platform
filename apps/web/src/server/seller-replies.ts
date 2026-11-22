import { assertAuditMetadataClean, checkReplyPolicy, type ReplySoftFlag, systemClock } from "@rp/core";
import type { Prisma } from "@rp/db";
import type { z } from "zod";
import type { Db } from "./db";
import { HttpError } from "./http";
import { requireSellerPermission } from "./sellers";
import type { Actor } from "./session";
import type { replyInput, replyRemoveInput, replyRestrictionInput } from "./validation";

/**
 * Seller replies (m3b-spec 5, ADR-0021, threat P-2). The seller is ALWAYS derived from review -> product -> seller on the
 * server (or reply.sellerId for edit/delete). No function here accepts a sellerId, productId or reviewId from a request body.
 */
type Tx = Prisma.TransactionClient;
const notFound = () => new HttpError(404, "not_found", "Not found");
const isP2002 = (e: unknown) => (e as { code?: string } | null)?.code === "P2002";

export interface ReplyHooks {
  /** Rate limit hook, called after authorization and before the content policy (step 11). */
  rateLimit?: (ctx: { sellerId: string; replyId?: string }) => Promise<void>;
  now?: Date;
}

function audit(tx: Tx, actor: { id: string; type?: "USER" | "STAFF" }, action: string, entityId: string, metadata: Prisma.InputJsonValue) {
  assertAuditMetadataClean(metadata); // never the body (R-4)
  return tx.auditLog.create({ data: { actorType: actor.type ?? "USER", actorId: actor.id, action, entityType: "SellerReply", entityId, metadata } });
}

function policyOrThrow(body: string): { body: string; soft: ReplySoftFlag[] } {
  const r = checkReplyPolicy(body);
  if (r.hard.length > 0) {
    throw new HttpError(422, "reply_policy_violation", `Reply rejected: ${r.hard.join(", ")}`, undefined, { reasons: r.hard });
  }
  return { body: r.body, soft: r.soft };
}

const submitted = (type: "seller_reply.submitted" | "seller_reply.edited", id: string, version: number) =>
  ({ type, aggregateId: id, payload: { subjectType: "SELLER_REPLY", subjectId: id, version } });

/** R1 / R5: create a reply (or reuse a DELETED row). The reply is PENDING, non-public, until moderation approves it. */
export async function createReply(db: Db, actor: Actor, reviewId: string, input: z.infer<typeof replyInput>, hooks: ReplyHooks = {}) {
  const now = hooks.now ?? systemClock.now();
  const review = await db.review.findFirst({ where: { id: reviewId }, select: { id: true, status: true, authorId: true, product: { select: { sellerId: true } } } });
  const sellerId = review?.product?.sellerId;
  if (!review || !sellerId) throw notFound(); // step 3: unknown review or unclaimed product
  await requireSellerPermission(db, actor, "seller.reply", sellerId, now); // steps 4-9, 404 for non-members
  if (review.authorId === actor.id) throw new HttpError(403, "CONFLICT_OF_INTEREST", "You cannot reply to your own review");
  if (review.status !== "PUBLISHED") throw new HttpError(409, "review_not_replyable", "Only published reviews can be replied to");
  await hooks.rateLimit?.({ sellerId });
  const policy = policyOrThrow(input.body);
  try {
    return await db.$transaction(async (tx) => {
      // Re-read ownership inside the transaction: the product may have changed hands since the authorization above.
      const cur = await tx.review.findFirst({ where: { id: reviewId }, select: { product: { select: { sellerId: true } } } });
      if (cur?.product?.sellerId !== sellerId) throw notFound();
      const existing = await tx.sellerReply.findUnique({ where: { reviewId_sellerId: { reviewId, sellerId } }, select: { id: true, status: true, version: true } });
      let id: string, version: number;
      if (existing) {
        if (existing.status !== "DELETED") throw new HttpError(409, "already_replied", "This review already has a reply from your seller");
        version = existing.version + 1;
        id = existing.id;
        const r = await tx.sellerReply.updateMany({
          where: { id, status: "DELETED", version: existing.version },
          data: { body: policy.body, version, status: "PENDING", authorId: actor.id, editedAt: now, deletedAt: null, deletedById: null },
        });
        if (r.count !== 1) throw new HttpError(409, "conflict", "Reply changed, reload and retry");
      } else {
        version = 1;
        id = (await tx.sellerReply.create({ data: { reviewId, sellerId, authorId: actor.id, body: policy.body, version, status: "PENDING" }, select: { id: true } })).id;
      }
      await tx.outboxEvent.create({ data: submitted("seller_reply.submitted", id, version) });
      await audit(tx, actor, "seller_reply.created", id, { sellerId, reviewId, version, flags: policy.soft });
      return { id, status: "PENDING" as const, version };
    });
  } catch (e) {
    if (isP2002(e)) throw new HttpError(409, "already_replied", "This review already has a reply from your seller");
    throw e;
  }
}

async function loadReplyForActor(db: Db, actor: Actor, replyId: string, waiveReplyGates: boolean, now: Date) {
  const reply = await db.sellerReply.findUnique({
    where: { id: replyId },
    select: { id: true, sellerId: true, authorId: true, reviewId: true, status: true, version: true, review: { select: { product: { select: { sellerId: true } } } } },
  });
  if (!reply) throw notFound();
  // Scope is reply.sellerId, loaded from the row (never the request).
  const { role } = await requireSellerPermission(db, actor, "seller.reply.manage", reply.sellerId, now, { waiveReplyGates });
  // RESPONDERs may change only their own replies; OWNER/MANAGER any reply of the seller.
  if (role === "RESPONDER" && reply.authorId !== actor.id) throw new HttpError(403, "FORBIDDEN_ROLE", "You do not have permission to do that");
  return reply;
}

/** R2: edit. The reply becomes non-public until the new version is approved. */
export async function editReply(db: Db, actor: Actor, replyId: string, input: z.infer<typeof replyInput>, hooks: ReplyHooks = {}) {
  const now = hooks.now ?? systemClock.now();
  const reply = await loadReplyForActor(db, actor, replyId, false, now);
  if (reply.status === "DELETED") throw notFound();
  if (reply.status === "REMOVED") throw new HttpError(409, "reply_removed", "Removed replies cannot be edited");
  // The product changed hands: only delete is allowed.
  if (reply.review.product?.sellerId !== reply.sellerId) throw new HttpError(409, "reply_not_editable", "This reply can only be deleted");
  await hooks.rateLimit?.({ sellerId: reply.sellerId, replyId });
  const policy = policyOrThrow(input.body);
  const version = reply.version + 1;
  return db.$transaction(async (tx) => {
    const r = await tx.sellerReply.updateMany({
      where: { id: replyId, version: reply.version, status: { in: ["PENDING", "PUBLISHED", "HIDDEN", "REJECTED"] } },
      data: { body: policy.body, version, status: "PENDING", editedAt: now },
    });
    if (r.count !== 1) throw new HttpError(409, "conflict", "Reply changed, reload and retry");
    await tx.outboxEvent.create({ data: submitted("seller_reply.edited", replyId, version) });
    await audit(tx, actor, "seller_reply.edited", replyId, { sellerId: reply.sellerId, reviewId: reply.reviewId, version, flags: policy.soft });
    return { id: replyId, status: "PENDING" as const, version };
  });
}

/** R4: delete (soft). Allowed while restricted or when the seller is no longer VERIFIED. */
export async function deleteReply(db: Db, actor: Actor, replyId: string, now = systemClock.now()) {
  const reply = await loadReplyForActor(db, actor, replyId, true, now);
  if (reply.status === "DELETED") throw notFound();
  if (reply.status === "REMOVED") throw new HttpError(409, "reply_removed", "Removed replies cannot be deleted");
  return db.$transaction(async (tx) => {
    const r = await tx.sellerReply.updateMany({
      where: { id: replyId, version: reply.version, status: { in: ["PENDING", "PUBLISHED", "HIDDEN", "REJECTED"] } },
      data: { status: "DELETED", deletedAt: now, deletedById: actor.id },
    });
    if (r.count !== 1) throw new HttpError(409, "conflict", "Reply changed, reload and retry");
    await audit(tx, actor, "seller_reply.deleted", replyId, { sellerId: reply.sellerId, reviewId: reply.reviewId, version: reply.version });
    return { id: replyId, status: "DELETED" as const };
  });
}

/** Dashboard list: any member of THE seller (path resource), others get 404. */
export async function listSellerReplies(db: Db, actor: Actor, sellerId: string, q: { status?: string; page: number; pageSize: number }) {
  const m = await db.sellerMember.findUnique({ where: { sellerId_userId: { sellerId, userId: actor.id } }, select: { role: true } });
  if (!m) throw notFound();
  const where = { sellerId, ...(q.status ? { status: q.status as never } : {}) };
  const [items, total] = await Promise.all([
    db.sellerReply.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      select: { id: true, reviewId: true, status: true, version: true, body: true, createdAt: true, editedAt: true, publishedAt: true },
    }),
    db.sellerReply.count({ where }),
  ]);
  return { items, page: q.page, pageSize: q.pageSize, total };
}

/**
 * Public rendering rule (m3b-spec 5.5), evaluated on every read: PUBLISHED, reply.sellerId = product.sellerId and the seller is
 * VERIFIED. The DTO has no author identity. Returns a map reviewId -> reply DTO.
 */
export async function publicRepliesFor(db: Pick<Db, "sellerReply">, productSellerId: string | null | undefined, reviewIds: string[]) {
  const out = new Map<string, { body: string; seller: { name: string; slug: string }; publishedAt: Date | null; editedAt: Date | null }>();
  if (!productSellerId || reviewIds.length === 0) return out;
  const rows = await db.sellerReply.findMany({
    where: { reviewId: { in: reviewIds }, status: "PUBLISHED", sellerId: productSellerId, seller: { status: "VERIFIED" } },
    select: { reviewId: true, body: true, publishedAt: true, editedAt: true, seller: { select: { name: true, slug: true } } },
  });
  for (const r of rows) out.set(r.reviewId, { body: r.body, seller: r.seller, publishedAt: r.publishedAt, editedAt: r.editedAt });
  return out;
}

const requireStaff = (actor: Actor) => {
  if (actor.role !== "admin" && actor.role !== "super_admin") throw new HttpError(403, "forbidden", "Admin access required");
};

/** R3: staff removal of a PUBLISHED reply. Final in M3b. */
export async function removeReply(db: Db, actor: Actor, replyId: string, input: z.infer<typeof replyRemoveInput>) {
  requireStaff(actor);
  return db.$transaction(async (tx) => {
    const reply = await tx.sellerReply.findUnique({ where: { id: replyId }, select: { id: true, sellerId: true, reviewId: true, version: true, authorId: true } });
    if (!reply) throw notFound();
    if (reply.authorId === actor.id) throw new HttpError(403, "self_moderation_forbidden", "You cannot moderate your own reply");
    const member = await tx.sellerMember.findUnique({ where: { sellerId_userId: { sellerId: reply.sellerId, userId: actor.id } }, select: { userId: true } });
    if (member) throw new HttpError(403, "CONFLICT_OF_INTEREST", "You are a member of this seller");
    const r = await tx.sellerReply.updateMany({ where: { id: replyId, status: "PUBLISHED" }, data: { status: "REMOVED" } });
    if (r.count !== 1) throw new HttpError(409, "illegal_transition", "Only published replies can be removed");
    await audit(tx, { id: actor.id, type: "STAFF" }, "seller_reply.removed", replyId, { sellerId: reply.sellerId, reviewId: reply.reviewId, version: reply.version, reasonCode: input.reasonCode });
    return { id: replyId, status: "REMOVED" as const };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// SELLER_REPLY_RESTRICTION (m3b-spec 5.7). ADMIN tier, route adds 2FA staff gate + step-up.
// ---------------------------------------------------------------------------------------------------------------------

const requireAdminTier = (actor: Actor) => {
  if (actor.role !== "admin" && actor.role !== "super_admin") throw new HttpError(403, "forbidden", "Admin access required");
};

/** COI: the issuer must not be a member of the seller (seller subject) nor of any seller the subject user belongs to. */
async function assertIssuerNotConflicted(tx: Tx, actorId: string, subject: { sellerId: string } | { userId: string }) {
  const sellerIds = "sellerId" in subject
    ? [subject.sellerId]
    : (await tx.sellerMember.findMany({ where: { userId: subject.userId }, select: { sellerId: true } })).map((m) => m.sellerId);
  if (sellerIds.length === 0) return;
  const mine = await tx.sellerMember.findFirst({ where: { userId: actorId, sellerId: { in: sellerIds } }, select: { userId: true } });
  if (mine) throw new HttpError(403, "CONFLICT_OF_INTEREST", "You are a member of an affected seller");
}

export async function issueReplyRestriction(db: Db, actor: Actor, subject: { sellerId: string } | { userId: string }, input: z.infer<typeof replyRestrictionInput>, now = systemClock.now()) {
  requireAdminTier(actor);
  if (input.endsAt && input.endsAt <= now) throw new HttpError(400, "validation_error", "endsAt must be in the future");
  return db.$transaction(async (tx) => {
    if ("sellerId" in subject) {
      if (!(await tx.seller.findUnique({ where: { id: subject.sellerId }, select: { id: true } }))) throw notFound();
    } else if (!(await tx.user.findUnique({ where: { id: subject.userId }, select: { id: true } }))) throw notFound();
    await assertIssuerNotConflicted(tx, actor.id, subject);
    const a = await tx.enforcementAction.create({
      data: {
        type: "SELLER_REPLY_RESTRICTION", reasonCode: input.reasonCode, publicReason: input.publicReason, issuedById: actor.id, startsAt: now, endsAt: input.endsAt ?? null,
        ...("sellerId" in subject ? { subjectSellerId: subject.sellerId } : { subjectUserId: subject.userId }),
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: { actorType: "STAFF", actorId: actor.id, action: "enforcement.issued", entityType: "sellerId" in subject ? "Seller" : "User", entityId: "sellerId" in subject ? subject.sellerId : subject.userId, metadata: { enforcementId: a.id, type: "SELLER_REPLY_RESTRICTION", reasonCode: input.reasonCode } },
    });
    return { enforcementId: a.id };
  });
}

export async function liftReplyRestriction(db: Db, actor: Actor, enforcementId: string, now = systemClock.now()) {
  requireAdminTier(actor);
  return db.$transaction(async (tx) => {
    const e = await tx.enforcementAction.findFirst({ where: { id: enforcementId, type: "SELLER_REPLY_RESTRICTION", status: "ACTIVE" }, select: { id: true, subjectSellerId: true, subjectUserId: true } });
    if (!e) throw notFound();
    await assertIssuerNotConflicted(tx, actor.id, e.subjectSellerId ? { sellerId: e.subjectSellerId } : { userId: e.subjectUserId! });
    const r = await tx.enforcementAction.updateMany({ where: { id: e.id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: now, revokedById: actor.id } });
    if (r.count !== 1) throw notFound();
    await tx.auditLog.create({
      data: { actorType: "STAFF", actorId: actor.id, action: "enforcement.revoked", entityType: e.subjectSellerId ? "Seller" : "User", entityId: (e.subjectSellerId ?? e.subjectUserId)!, metadata: { enforcementId: e.id, type: "SELLER_REPLY_RESTRICTION" } },
    });
    return { enforcementId: e.id, status: "REVOKED" as const };
  });
}
