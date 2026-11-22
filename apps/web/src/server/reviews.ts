import type { Db } from "./db";
import { HttpError } from "./http";
import { readyMediaUrls, type Storage } from "./media";
import { publicRepliesFor } from "./seller-replies";
import { myVotes } from "./votes";
import { INCENTIVE_VALUES, type ReviewInput, type reviewEditInput } from "./validation";
import type { z } from "zod";
import { MEDIA_MAX_PER_REVIEW, systemClock } from "@rp/core";
import type { Actor } from "./session";

const publicSelect = {
  id: true, productId: true, rating: true, title: true, body: true, incentive: true, verifiedBuyer: true, verifiedPurchaseAt: true, verificationMethod: true,
  helpfulCount: true, notHelpfulCount: true, publishedAt: true, editedAt: true,
  author: { select: { handle: true, displayName: true } }, // never expose email
} as const;

const ownSelect = {
  id: true, productId: true, rating: true, title: true, body: true, status: true,
  currentVersion: true, publishedVersion: true, incentive: true, createdAt: true, updatedAt: true,
} as const;

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/** Published reviews only, newest first, paginated. */
export async function listPublishedReviews(db: Db, productId: string, page: number, pageSize: number, storage?: Storage, opts: { verifiedOnly?: boolean; viewerId?: string | null } = {}) {
  const product = await db.product.findFirst({ where: { id: productId, status: "ACTIVE" }, select: { id: true, sellerId: true } });
  if (!product) throw new HttpError(404, "not_found", "Product not found");
  const where = { productId, status: "PUBLISHED" as const, ...(opts.verifiedOnly ? { verifiedPurchaseAt: { not: null } } : {}) };
  const [items, total, verifiedCount, allCount] = await Promise.all([
    db.review.findMany({
      where, select: publicSelect, orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize, take: pageSize,
    }),
    db.review.count({ where }),
    db.review.count({ where: { productId, status: "PUBLISHED", verifiedPurchaseAt: { not: null } } }),
    db.review.count({ where: { productId, status: "PUBLISHED" } }),
  ]);
  const mine = await myVotes(db, opts.viewerId ?? null, items.map((r) => r.id));
  // Media is shown only when it is READY and its review is PUBLISHED.
  const media = storage ? await readyMediaUrls(db, storage, items.map((r) => r.id)) : new Map();
  // Seller replies are embedded only while PUBLISHED, owned by the product's current seller and VERIFIED (m3b-spec 5.5).
  const replies = await publicRepliesFor(db, product.sellerId, items.map((r) => r.id));
  // Verified share is computed at read time (m4-m5-spec 5.1). `myVote` is the caller's own vote only.
  return { items: items.map((r) => ({ ...r, media: media.get(r.id) ?? [], reply: replies.get(r.id) ?? null, myVote: mine.get(r.id) ?? null })), page, pageSize, total, verified: { count: verifiedCount, of: allCount } };
}

/** New reviews always start PENDING; the review, its first revision and the outbox event commit atomically. */
export async function createReview(db: Db, userId: string, productId: string, input: ReviewInput) {
  const product = await db.product.findFirst({ where: { id: productId, status: "ACTIVE" }, select: { id: true } });
  if (!product) throw new HttpError(404, "not_found", "Product not found");
  try {
    return await db.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          productId, authorId: userId, rating: input.rating, title: input.title, body: input.body,
          status: "PENDING",
          revisions: { create: { version: 1, rating: input.rating, title: input.title, body: input.body, editorId: userId, status: "PENDING" } },
        },
        select: ownSelect,
      });
      await tx.outboxEvent.create({ data: { type: "review.submitted", aggregateId: review.id, payload: { subjectType: "REVIEW", subjectId: review.id, version: 1, trigger: "SUBMISSION" } } });
      return review;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "already_reviewed", "You have already reviewed this product");
    throw e;
  }
}

type Tx = Db;
const NEXT_STATUS_PATH = new Set(["PENDING", "HIDDEN"]);

/**
 * Edit own review (m4-m5-spec 3). PENDING/HIDDEN: in-place (T14), old open revision and case become SUPERSEDED.
 * PUBLISHED: R1, the row keeps the live text and a new PENDING revision is written. REJECTED/REMOVED: 409; DELETED/other: 404.
 */
export async function editOwnReview(db: Db, userId: string, reviewId: string, input: z.infer<typeof reviewEditInput>, ctx: { charge?: (live: boolean) => Promise<void> } = {}) {
  // SEL-013: the incentive disclosure is re-validated on every edit, here as well as in the route schema.
  if (input.incentive !== undefined && !(INCENTIVE_VALUES as readonly string[]).includes(input.incentive)) throw new HttpError(400, "invalid_incentive", "Invalid incentive value");
  const cur = await db.review.findFirst({
    where: { id: reviewId, authorId: userId, status: { not: "DELETED" } }, // someone else's review is indistinguishable from a missing one (deny reason NOT_OWNER stays internal)
    select: { id: true, status: true, currentVersion: true, publishedVersion: true, rating: true, title: true, body: true, incentive: true, product: { select: { sellerId: true } } },
  });
  if (!cur) throw new HttpError(404, "not_found", "Review not found");
  if (cur.status === "REJECTED" || cur.status === "REMOVED") throw new HttpError(409, "not_editable", "This review can no longer be edited");
  if (input.expectedVersion !== cur.currentVersion) throw new HttpError(409, "version_conflict", "Review changed, reload and retry");
  const live = cur.status === "PUBLISHED";
  await ctx.charge?.(live);
  const next = { rating: input.rating ?? cur.rating, title: input.title ?? cur.title, body: input.body ?? cur.body, incentive: input.incentive ?? cur.incentive };
  const version = cur.currentVersion + 1;
  return db.$transaction(async (t) => {
    const tx = t as unknown as Tx;
    // Guarded on status + version so a concurrent moderation decision or edit cannot be overwritten.
    const res = await tx.review.updateMany({
      where: { id: reviewId, authorId: userId, status: cur.status, currentVersion: cur.currentVersion },
      data: live ? { currentVersion: version } : { ...next, currentVersion: version, editedAt: systemClock.now(), status: "PENDING" },
    });
    if (res.count !== 1) throw new HttpError(409, "version_conflict", "Review changed, reload and retry");
    await tx.reviewRevision.updateMany({ where: { reviewId, status: { in: ["PENDING", "HELD"] } }, data: { status: "SUPERSEDED" } });
    await tx.moderationCase.updateMany({ where: { reviewId, state: { in: ["PENDING", "AI_REVIEW", "NEEDS_HUMAN"] }, trigger: { in: ["SUBMISSION", "EDIT"] } }, data: { state: "SUPERSEDED" } });
    await tx.reviewRevision.create({ data: { reviewId, version, ...next, editorId: userId, status: "PENDING" } });

    // Media per revision (3.4): claim staged assets, detach removed ones; the case for `version` assesses exactly the visible set.
    if (input.addMediaIds?.length || input.removeMediaIds?.length || live) {
      const assets = await tx.mediaAsset.findMany({ where: { reviewId }, select: { id: true, ownerId: true, status: true, attachedInVersion: true, detachedInVersion: true } });
      const byId = new Map(assets.map((a) => [a.id, a]));
      for (const aid of input.addMediaIds ?? []) {
        const a = byId.get(aid);
        if (!a || a.ownerId !== userId || a.attachedInVersion !== null || !["PROCESSING", "READY"].includes(a.status)) throw new HttpError(409, "media_not_attachable", "Media cannot be attached to this review");
        a.attachedInVersion = version;
      }
      for (const aid of input.removeMediaIds ?? []) {
        const a = byId.get(aid);
        if (!a || a.attachedInVersion === null || a.detachedInVersion !== null) throw new HttpError(409, "media_not_attachable", "Media cannot be removed from this review");
        a.detachedInVersion = version;
      }
      const visible = assets.filter((a) => a.attachedInVersion !== null && a.attachedInVersion <= version && (a.detachedInVersion === null || a.detachedInVersion > version)).length;
      if (visible > MEDIA_MAX_PER_REVIEW) throw new HttpError(409, "media_limit", `At most ${MEDIA_MAX_PER_REVIEW} images per review`);
      if (input.addMediaIds?.length) await tx.mediaAsset.updateMany({ where: { id: { in: input.addMediaIds }, reviewId, ownerId: userId, attachedInVersion: null }, data: { attachedInVersion: version } });
      if (input.removeMediaIds?.length) await tx.mediaAsset.updateMany({ where: { id: { in: input.removeMediaIds }, reviewId, detachedInVersion: null }, data: { detachedInVersion: version } });
    }
    // D-1: the payload is the moderationJobSchema shape; `review.submitted` for T14, `review.edited` for R1.
    await tx.outboxEvent.create({ data: { type: live ? "review.edited" : "review.submitted", aggregateId: reviewId, payload: { subjectType: "REVIEW", subjectId: reviewId, version, trigger: "EDIT" } } });
    await tx.auditLog.create({ data: { actorType: "USER", actorId: userId, action: "review.revision_submit", entityType: "Review", entityId: reviewId, metadata: { version } } });
    const row = await tx.review.findUniqueOrThrow({ where: { id: reviewId }, select: ownSelect });
    return { ...row, pendingRevision: { version, status: "PENDING" as const } };
  });
}

/** Back-compat wrapper for the pre-M4 PATCH shape (no expectedVersion): applies to the current version. */
export async function updateOwnReview(db: Db, userId: string, reviewId: string, patch: Partial<ReviewInput>) {
  const cur = await db.review.findFirst({ where: { id: reviewId, authorId: userId, status: { not: "DELETED" } }, select: { status: true, currentVersion: true } });
  if (!cur) throw new HttpError(404, "not_found", "Review not found");
  if (!NEXT_STATUS_PATH.has(cur.status)) throw new HttpError(409, "not_editable", "Only pending reviews can be changed without expectedVersion");
  return editOwnReview(db, userId, reviewId, { expectedVersion: cur.currentVersion, ...patch });
}

/** Author and staff only (the public route never includes revisions). A non-author gets the same 404 as a missing review. */
export async function listRevisions(db: Db, actor: Actor, reviewId: string) {
  const staff = actor.role === "admin" || actor.role === "super_admin";
  // SEC-M4-03: staff permissions are inactive without an enrolled and verified second factor (m3b-spec 2.9).
  if (staff && (!actor.twoFactor?.enrolled || !actor.twoFactor.verified)) throw new HttpError(403, "TWO_FACTOR_REQUIRED", "Two-factor authentication required");
  const r = await db.review.findFirst({ where: { id: reviewId, ...(staff ? {} : { authorId: actor.id }) }, select: { id: true } });
  if (!r) throw new HttpError(404, "not_found", "Review not found");
  return db.reviewRevision.findMany({ where: { reviewId }, orderBy: { version: "desc" }, select: { version: true, status: true, rating: true, title: true, body: true, createdAt: true } });
}

/** Soft delete (ADR-0004). T13/T19: allowed from PENDING, HIDDEN, PUBLISHED, REJECTED, REMOVED. Open cases become SUPERSEDED. */
export async function deleteOwnReview(db: Db, userId: string, reviewId: string) {
  const r = await db.review.findFirst({ where: { id: reviewId, authorId: userId, status: { not: "DELETED" } }, select: { id: true, status: true } });
  if (!r) throw new HttpError(404, "not_found", "Review not found");
  await db.$transaction(async (t) => {
    const tx = t as unknown as Tx;
    const res = await tx.review.updateMany({ where: { id: reviewId, authorId: userId, status: r.status }, data: { status: "DELETED", deletedAt: systemClock.now() } });
    if (res.count !== 1) throw new HttpError(409, "not_editable", "Review changed, reload and retry");
    await tx.moderationCase.updateMany({ where: { reviewId, state: { in: ["PENDING", "AI_REVIEW", "NEEDS_HUMAN"] } }, data: { state: "SUPERSEDED", openReportKey: null } });
    await tx.reviewRevision.updateMany({ where: { reviewId, status: { in: ["PENDING", "HELD"] } }, data: { status: "SUPERSEDED" } });
    // Proof files are purged by the retention job once the proof is closed (m4-m5-spec 5.8).
    await tx.purchaseProof.updateMany({ where: { reviewId, status: { in: ["DRAFT", "PENDING"] } }, data: { status: "WITHDRAWN", closeReason: "USER_WITHDRAWN", closedAt: systemClock.now(), openKey: null, filesDeleteRequestedAt: systemClock.now() } });
    await tx.auditLog.create({ data: { actorType: "USER", actorId: userId, action: "review.delete", entityType: "Review", entityId: reviewId, metadata: { fromStatus: r.status } } });
  });
}
