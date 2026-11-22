import {
  MEDIA_GET_TTL_SECONDS,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_PER_REVIEW,
  MEDIA_PUT_TTL_SECONDS,
  ingestKey,
  type ObjectStore,
  type UploadSlotInput,
} from "@rp/core";
import type { Db } from "./db";
import { HttpError } from "./http";

export interface Storage {
  store: ObjectStore;
  buckets: { ingest: string; private: string };
}

/** SEC-02 / m4-m5-spec 3.4: media may be added while the review is under moderation (PENDING) or staged for the next edit of a PUBLISHED review. */
function assertPendingForMedia(status: string) {
  if (status !== "PENDING" && status !== "PUBLISHED") throw new HttpError(409, "not_editable", "Media can only be added to pending or published reviews");
}

const ownSelect = { id: true, reviewId: true, status: true, failureReason: true, width: true, height: true, createdAt: true } as const;

/**
 * Issues a presigned PUT for one image. Type/size are validated by uploadSlotInput; ownership and the per-review
 * cap are checked here. Content-Type and Content-Length are part of the signature.
 * `dailyQuota` comes from config (MEDIA_DAILY_QUOTA).
 */
export async function createUploadSlot(db: Db, st: Storage, userId: string, reviewId: string, input: UploadSlotInput, dailyQuota = 50) {
  if (input.sizeBytes > MEDIA_MAX_BYTES) throw new HttpError(413, "too_large", "Image exceeds 10 MB");
  const review = await db.review.findFirst({ where: { id: reviewId, authorId: userId, status: { not: "DELETED" } }, select: { id: true, status: true, currentVersion: true } });
  if (!review) throw new HttpError(404, "not_found", "Review not found"); // also hides other users' reviews
  assertPendingForMedia(review.status);
  // SEC-03: per-user rolling-24h quota over ALL statuses, so FAILED/expired slots still count (no slot->junk->FAILED loop).
  const today = await db.mediaAsset.count({ where: { ownerId: userId, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } });
  if (today >= dailyQuota) throw new HttpError(429, "upload_quota", "Daily upload limit reached, try again later", { "Retry-After": "3600" });
  const used = await db.mediaAsset.count({ where: { reviewId, status: { in: ["UPLOADING", "PROCESSING", "READY"] } } });
  if (used >= MEDIA_MAX_PER_REVIEW) throw new HttpError(409, "media_limit", `At most ${MEDIA_MAX_PER_REVIEW} images per review`);
  const asset = await db.mediaAsset.create({
    // PENDING: covered by the current version's moderation. PUBLISHED: staged (NULL) until an edit claims it.
    data: { ownerId: userId, reviewId, status: "UPLOADING", declaredMime: input.mimeType, sizeBytes: input.sizeBytes, ingestKey: "pending", attachedInVersion: review.status === "PENDING" ? review.currentVersion : null },
    select: { id: true },
  });
  const key = ingestKey(asset.id);
  await db.mediaAsset.update({ where: { id: asset.id }, data: { ingestKey: key } });
  const uploadUrl = await st.store.presignPut(st.buckets.ingest, key, {
    contentType: input.mimeType, contentLength: input.sizeBytes, expiresIn: MEDIA_PUT_TTL_SECONDS,
  });
  return {
    assetId: asset.id, uploadUrl, method: "PUT" as const, expiresIn: MEDIA_PUT_TTL_SECONDS,
    headers: { "Content-Type": input.mimeType, "Content-Length": String(input.sizeBytes) },
  };
}

/** Confirms the browser upload: object must exist with the declared size; then UPLOADING -> PROCESSING + outbox event. */
export async function confirmUpload(db: Db, st: Storage, userId: string, assetId: string) {
  const a = await db.mediaAsset.findFirst({ where: { id: assetId, ownerId: userId }, select: { id: true, status: true, sizeBytes: true, ingestKey: true, review: { select: { status: true } } } });
  if (!a) throw new HttpError(404, "not_found", "Media not found");
  if (a.status === "UPLOADING") assertPendingForMedia(a.review.status);
  if (a.status !== "UPLOADING") return db.mediaAsset.findUniqueOrThrow({ where: { id: assetId }, select: ownSelect }); // idempotent
  const head = await st.store.head(st.buckets.ingest, a.ingestKey);
  const bad = !head ? "MISSING_OBJECT" : head.size !== a.sizeBytes || head.size > MEDIA_MAX_BYTES ? (head.size > MEDIA_MAX_BYTES ? "TOO_LARGE" : "TYPE_MISMATCH") : null;
  if (bad) {
    await db.mediaAsset.updateMany({ where: { id: assetId, status: "UPLOADING" }, data: { status: "FAILED", failureReason: bad } });
    if (head) await st.store.delete(st.buckets.ingest, a.ingestKey);
    throw new HttpError(422, "upload_invalid", bad === "MISSING_OBJECT" ? "Upload not found, retry" : "Uploaded file does not match the declared size");
  }
  return db.$transaction(async (tx) => {
    const res = await tx.mediaAsset.updateMany({ where: { id: assetId, ownerId: userId, status: "UPLOADING" }, data: { status: "PROCESSING" } });
    if (res.count === 1) await tx.outboxEvent.create({ data: { type: "media.uploaded", aggregateId: assetId, payload: { assetId } } });
    return tx.mediaAsset.findUniqueOrThrow({ where: { id: assetId }, select: ownSelect });
  });
}

/** Owner's view of a review's media, including FAILED items and why, so failures are surfaced. */
export async function listOwnMedia(db: Db, userId: string, reviewId: string) {
  const items = await db.mediaAsset.findMany({ where: { reviewId, ownerId: userId }, select: ownSelect, orderBy: { createdAt: "asc" } });
  return { items };
}

/** Adds signed variant URLs for READY media of already-PUBLISHED reviews (callers filter on review status). */
export async function readyMediaUrls(db: Db, st: Storage, reviewIds: string[]) {
  const out = new Map<string, { id: string; width: number | null; height: number | null; thumbUrl: string; mediumUrl: string }[]>();
  if (!reviewIds.length) return out;
  const rows = await db.mediaAsset.findMany({
    where: { reviewId: { in: reviewIds }, status: "READY", thumbKey: { not: null }, mediumKey: { not: null }, review: { status: "PUBLISHED" } },
    select: { id: true, reviewId: true, createdAt: true, width: true, height: true, thumbKey: true, mediumKey: true, attachedInVersion: true, detachedInVersion: true, review: { select: { publishedAt: true, publishedVersion: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const r of rows) {
    // SEC-02: only assets visible in the published version were seen by moderators:
    // attachedInVersion <= v AND (detachedInVersion IS NULL OR detachedInVersion > v). NULL attached = staged, never public.
    const v = r.review.publishedVersion;
    if (v == null || r.attachedInVersion == null || r.attachedInVersion > v || (r.detachedInVersion != null && r.detachedInVersion <= v)) continue;
    const item = {
      id: r.id, width: r.width, height: r.height,
      thumbUrl: await st.store.presignGet(st.buckets.private, r.thumbKey!, MEDIA_GET_TTL_SECONDS),
      mediumUrl: await st.store.presignGet(st.buckets.private, r.mediumKey!, MEDIA_GET_TTL_SECONDS),
    };
    (out.get(r.reviewId) ?? out.set(r.reviewId, []).get(r.reviewId)!).push(item);
  }
  return out;
}
