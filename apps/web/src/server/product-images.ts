import {
  MEDIA_ALLOWED_MIME,
  MEDIA_MAX_BYTES,
  MEDIA_PUT_TTL_SECONDS,
  PRODUCT_IMAGE_MAX,
  assertAuditMetadataClean,
  buildGallery,
  ingestKey,
  pickPrimary,
  planReorder,
  systemClock,
  type ImageUrlResolver,
  type ProductImageRow,
} from "@rp/core";
import type { Prisma } from "@rp/db";
import type { Db } from "./db";
import { HttpError } from "./http";
import type { Actor } from "./session";
import { requireSellerPermission } from "./sellers";
import type { Storage } from "./media";

type Tx = Prisma.TransactionClient;
const isStaffAdmin = (a: Actor) => a.role === "admin" || a.role === "super_admin";
const rowSelect = { id: true, productId: true, publicId: true, format: true, width: true, height: true, alt: true, position: true, isPrimary: true, publishedAt: true, createdAt: true } as const;

/**
 * Who may manage a product's gallery (ADR-0034 D11): ADMIN/SUPER_ADMIN staff, or an OWNER/MANAGER member of the product's VERIFIED
 * owning seller. The seller comes from the product row, never from client input (P-2). Everyone else gets 403 (a non-owner seller
 * is not told whether the product belongs to someone else).
 */
export async function assertCanManageImages(db: Db, actor: Actor, productId: string) {
  const p = await db.product.findUnique({ where: { id: productId }, select: { id: true, name: true, sellerId: true, status: true } });
  if (!p || p.status === "REMOVED") throw new HttpError(404, "not_found", "Product not found");
  if (isStaffAdmin(actor)) {
    if (!(actor.twoFactor?.enrolled && actor.twoFactor.verified)) throw new HttpError(403, "TWO_FACTOR_REQUIRED", "Second factor required");
    return p;
  }
  if (!p.sellerId) throw new HttpError(403, "forbidden", "You do not have permission to manage this product's images");
  try {
    await requireSellerPermission(db, actor, "product.image.manage", p.sellerId);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) throw new HttpError(403, "forbidden", "You do not have permission to manage this product's images");
    throw e;
  }
  const seller = await db.seller.findUnique({ where: { id: p.sellerId }, select: { status: true } });
  if (seller?.status !== "VERIFIED") throw new HttpError(403, "SELLER_NOT_VERIFIED", "The seller must be verified to manage product images");
  return p;
}

function audit(tx: Tx, actor: Actor, action: string, entityId: string, metadata: Prisma.InputJsonValue) {
  assertAuditMetadataClean(metadata);
  return tx.auditLog.create({ data: { actorType: actor.role === "user" ? "USER" : "STAFF", actorId: actor.id, action, entityType: "ProductImage", entityId, metadata } });
}

export interface ImageSlotInput { mimeType: (typeof MEDIA_ALLOWED_MIME)[number]; sizeBytes: number; alt: string }

/**
 * Adds an image slot: MediaAsset (purpose PRODUCT_IMAGE, no review) + ProductImage (alt required) + presigned PUT. Goes through the
 * normal confirm -> worker scan/sanitise flow; it is invisible to the public until a moderator approves it and `media.promote` runs.
 */
export async function createProductImageSlot(db: Db, st: Storage, actor: Actor, productId: string, input: ImageSlotInput, dailyQuota = 50) {
  if (input.sizeBytes > MEDIA_MAX_BYTES) throw new HttpError(413, "too_large", "Image exceeds 10 MB");
  const product = await assertCanManageImages(db, actor, productId);
  const since = new Date(systemClock.now().getTime() - 24 * 3600 * 1000);
  if ((await db.mediaAsset.count({ where: { ownerId: actor.id, createdAt: { gte: since } } })) >= dailyQuota) {
    throw new HttpError(429, "upload_quota", "Daily upload limit reached, try again later", { "Retry-After": "3600" });
  }
  const key = (id: string) => ingestKey(id);
  const created = await db.$transaction(async (tx) => {
    // Cap counts pending images too (a removed image has no row). Serialised per product by locking the product row.
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;
    const n = await tx.productImage.count({ where: { productId } });
    if (n >= PRODUCT_IMAGE_MAX) throw new HttpError(409, "image_limit", `At most ${PRODUCT_IMAGE_MAX} images per product`);
    const asset = await tx.mediaAsset.create({
      data: { ownerId: actor.id, purpose: "PRODUCT_IMAGE", reviewId: null, kind: "IMAGE", status: "UPLOADING", declaredMime: input.mimeType, sizeBytes: input.sizeBytes, ingestKey: "pending" },
      select: { id: true },
    });
    await tx.mediaAsset.update({ where: { id: asset.id }, data: { ingestKey: key(asset.id) } });
    const img = await tx.productImage.create({
      data: { productId, mediaAssetId: asset.id, alt: input.alt, position: n, isPrimary: n === 0, createdById: actor.id },
      select: { id: true },
    });
    await audit(tx, actor, "product_image.created", img.id, { productId, assetId: asset.id });
    return { assetId: asset.id, imageId: img.id };
  });
  const uploadUrl = await st.store.presignPut(st.buckets.ingest, key(created.assetId), { contentType: input.mimeType, contentLength: input.sizeBytes, expiresIn: MEDIA_PUT_TTL_SECONDS });
  return {
    imageId: created.imageId, assetId: created.assetId, productName: product.name, uploadUrl, method: "PUT" as const, expiresIn: MEDIA_PUT_TTL_SECONDS,
    headers: { "Content-Type": input.mimeType, "Content-Length": String(input.sizeBytes) },
  };
}

async function loadImage(db: Db | Tx, productId: string, imageId: string) {
  const img = await db.productImage.findFirst({ where: { id: imageId, productId }, select: { id: true, productId: true, mediaAssetId: true, isPrimary: true } });
  if (!img) throw new HttpError(404, "not_found", "Image not found");
  return img;
}

/** Management view (includes unpublished images and their processing state). */
export async function listProductImagesForManager(db: Db, actor: Actor, productId: string, r: ImageUrlResolver) {
  await assertCanManageImages(db, actor, productId);
  const rows = await db.productImage.findMany({ where: { productId }, select: { ...rowSelect, mediaAsset: { select: { status: true, failureReason: true } } }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  return { items: rows.map((x) => ({ id: x.id, alt: x.alt, position: x.position, isPrimary: x.isPrimary, published: !!x.publishedAt, status: x.mediaAsset.status, failureReason: x.mediaAsset.failureReason, ...(buildGallery([x], r)[0] ?? {}) })) };
}

export async function updateProductImage(db: Db, actor: Actor, productId: string, imageId: string, patch: { alt?: string; isPrimary?: true }) {
  await assertCanManageImages(db, actor, productId);
  return db.$transaction(async (tx) => {
    await loadImage(tx, productId, imageId);
    if (patch.alt !== undefined) await tx.productImage.update({ where: { id: imageId }, data: { alt: patch.alt } });
    if (patch.isPrimary) {
      // The generated unique column allows one primary per product: clear the old one first.
      await tx.productImage.updateMany({ where: { productId, isPrimary: true, id: { not: imageId } }, data: { isPrimary: false } });
      await tx.productImage.update({ where: { id: imageId }, data: { isPrimary: true } });
    }
    await audit(tx, actor, "product_image.updated", imageId, { productId, altChanged: patch.alt !== undefined, primary: !!patch.isPrimary });
    return { ok: true as const };
  });
}

/** Renumbers 0..n-1 in one transaction (no unique constraint on position, so no transient collision). */
export async function reorderProductImages(db: Db, actor: Actor, productId: string, orderedIds: string[]) {
  await assertCanManageImages(db, actor, productId);
  return db.$transaction(async (tx) => {
    const cur = await tx.productImage.findMany({ where: { productId }, select: { id: true } });
    const plan = planReorder(cur.map((c) => c.id), orderedIds);
    if (!plan) throw new HttpError(422, "invalid_order", "The order must list every image of the product exactly once");
    for (const [id, position] of plan) await tx.productImage.update({ where: { id }, data: { position } });
    await audit(tx, actor, "product_image.reordered", productId, { productId, count: plan.size });
    return { ok: true as const };
  });
}

/** Deletes the gallery row and asks the worker to demote the bytes (Cloudinary destroy with invalidate through the existing demote path). */
export async function removeProductImage(db: Db, actor: Actor, productId: string, imageId: string) {
  await assertCanManageImages(db, actor, productId);
  return db.$transaction(async (tx) => {
    const img = await loadImage(tx, productId, imageId);
    await tx.productImage.delete({ where: { id: imageId } });
    const rest = await tx.productImage.findMany({ where: { productId }, select: { id: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
    for (const [i, x] of rest.entries()) await tx.productImage.update({ where: { id: x.id }, data: { position: i } });
    await tx.outboxEvent.create({ data: { type: "media.demote_requested", aggregateId: img.mediaAssetId, payload: { assetId: img.mediaAssetId, reason: "PRODUCT_IMAGE_REMOVED" } } });
    await audit(tx, actor, "product_image.removed", imageId, { productId, assetId: img.mediaAssetId });
    return { ok: true as const };
  });
}

/**
 * Moderator decision on a scanned product image (staff uploads are not auto-cleared, MED-037). Approve records an APPROVED MEDIA
 * moderation case and asks the worker to promote; `media.promote` re-checks everything. A moderator cannot approve their own upload.
 */
export async function decideProductImage(db: Db, actor: Actor, imageId: string, decision: "approve" | "reject", now = systemClock.now()) {
  return db.$transaction(async (tx) => {
    const img = await tx.productImage.findUnique({ where: { id: imageId }, select: { id: true, productId: true, mediaAssetId: true, mediaAsset: { select: { ownerId: true, status: true, bucket: true } } } });
    if (!img) throw new HttpError(404, "not_found", "Image not found");
    if (img.mediaAsset.ownerId === actor.id) throw new HttpError(403, "self_approval", "You cannot decide on your own upload");
    if (decision === "reject") {
      await tx.productImage.delete({ where: { id: imageId } });
      await tx.outboxEvent.create({ data: { type: "media.demote_requested", aggregateId: img.mediaAssetId, payload: { assetId: img.mediaAssetId, reason: "PRODUCT_IMAGE_REJECTED" } } });
      await audit(tx, actor, "product_image.rejected", imageId, { productId: img.productId, assetId: img.mediaAssetId });
      return { ok: true as const, decision };
    }
    if (img.mediaAsset.status !== "READY" || img.mediaAsset.bucket !== "PRIVATE") throw new HttpError(409, "not_ready", "The image has not finished scanning");
    const c = await tx.moderationCase.create({
      data: { subjectType: "MEDIA", mediaAssetId: img.mediaAssetId, version: 1, state: "APPROVED", status: "RESOLVED", decidedById: actor.id, decidedAt: now, resolvedAt: now },
      select: { id: true },
    });
    await tx.outboxEvent.create({ data: { type: "media.promote_requested", aggregateId: img.mediaAssetId, payload: { assetId: img.mediaAssetId, caseId: c.id } } });
    await audit(tx, actor, "product_image.approved", imageId, { productId: img.productId, assetId: img.mediaAssetId, caseId: c.id });
    return { ok: true as const, decision };
  });
}

/** Public read: `primaryImage` per product (batched, one query) and the full `gallery` for detail/compare. */
export async function loadProductImages(db: Pick<Db, "productImage">, productIds: string[], r: ImageUrlResolver) {
  const out = new Map<string, { primaryImage: ReturnType<typeof pickPrimary>; gallery: ReturnType<typeof buildGallery> }>();
  if (!productIds.length) return out;
  const rows = (await db.productImage.findMany({ where: { productId: { in: productIds }, publishedAt: { not: null } }, select: rowSelect, orderBy: [{ position: "asc" }, { createdAt: "asc" }] })) as ProductImageRow[];
  const by = new Map<string, ProductImageRow[]>();
  for (const x of rows) (by.get(x.productId) ?? by.set(x.productId, []).get(x.productId)!).push(x);
  for (const id of productIds) { const g = by.get(id) ?? []; out.set(id, { primaryImage: pickPrimary(g, r), gallery: buildGallery(g, r) }); }
  return out;
}
