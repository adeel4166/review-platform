import type { Db } from "./db";
import { HttpError } from "./http";
import type { ReviewInput } from "./validation";

const publicSelect = {
  id: true, productId: true, rating: true, title: true, body: true, incentive: true,
  helpfulCount: true, notHelpfulCount: true, publishedAt: true, editedAt: true,
  author: { select: { handle: true, displayName: true } }, // never expose email
} as const;

const ownSelect = {
  id: true, productId: true, rating: true, title: true, body: true, status: true,
  currentVersion: true, createdAt: true, updatedAt: true,
} as const;

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/** Published reviews only, newest first, paginated. */
export async function listPublishedReviews(db: Db, productId: string, page: number, pageSize: number) {
  const product = await db.product.findFirst({ where: { id: productId, status: "ACTIVE" }, select: { id: true } });
  if (!product) throw new HttpError(404, "not_found", "Product not found");
  const where = { productId, status: "PUBLISHED" as const };
  const [items, total] = await Promise.all([
    db.review.findMany({
      where, select: publicSelect, orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize, take: pageSize,
    }),
    db.review.count({ where }),
  ]);
  return { items, page, pageSize, total };
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
      await tx.outboxEvent.create({ data: { type: "review.submitted", aggregateId: review.id, payload: { reviewId: review.id, version: 1 } } });
      return review;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "already_reviewed", "You have already reviewed this product");
    throw e;
  }
}

async function loadOwnEditable(db: Db, userId: string, reviewId: string) {
  const r = await db.review.findFirst({
    where: { id: reviewId, authorId: userId, status: { not: "DELETED" } },
    select: { id: true, status: true, currentVersion: true, rating: true, title: true, body: true },
  });
  // Someone else's review is indistinguishable from a missing one.
  if (!r) throw new HttpError(404, "not_found", "Review not found");
  if (r.status !== "PENDING") throw new HttpError(409, "not_editable", "Only pending reviews can be changed");
  return r;
}

export async function updateOwnReview(db: Db, userId: string, reviewId: string, patch: Partial<ReviewInput>) {
  const cur = await loadOwnEditable(db, userId, reviewId);
  const next = {
    rating: patch.rating ?? cur.rating,
    title: patch.title ?? cur.title,
    body: patch.body ?? cur.body,
  };
  const version = cur.currentVersion + 1;
  return db.$transaction(async (tx) => {
    // Guarded on status + version so a concurrent moderation decision or edit cannot be overwritten.
    const res = await tx.review.updateMany({
      where: { id: reviewId, authorId: userId, status: "PENDING", currentVersion: cur.currentVersion },
      data: { ...next, currentVersion: version, editedAt: new Date() },
    });
    if (res.count !== 1) throw new HttpError(409, "not_editable", "Review changed, reload and retry");
    await tx.reviewRevision.updateMany({ where: { reviewId, status: "PENDING" }, data: { status: "SUPERSEDED" } });
    await tx.reviewRevision.create({ data: { reviewId, version, ...next, editorId: userId, status: "PENDING" } });
    await tx.outboxEvent.create({ data: { type: "review.submitted", aggregateId: reviewId, payload: { reviewId, version } } });
    return tx.review.findUniqueOrThrow({ where: { id: reviewId }, select: ownSelect });
  });
}

/** Soft delete (ADR-0004: user content is never hard-deleted by the app). */
export async function deleteOwnReview(db: Db, userId: string, reviewId: string) {
  await loadOwnEditable(db, userId, reviewId);
  const res = await db.review.updateMany({
    where: { id: reviewId, authorId: userId, status: "PENDING" },
    data: { status: "DELETED", deletedAt: new Date() },
  });
  if (res.count !== 1) throw new HttpError(409, "not_editable", "Review changed, reload and retry");
}
