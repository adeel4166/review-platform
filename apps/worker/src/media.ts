import sharp from "sharp";
import {
  MEDIA_ALLOWED_MIME,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_PIXELS,
  MEDIA_VARIANTS,
  MediaTooLargeError,
  sniffImageMime,
  variantKey,
  type MediaFailureReason,
  type ObjectStore,
} from "@rp/core";

export interface MediaDb {
  mediaAsset: {
    findUnique(args: unknown): Promise<{ id: string; status: string; declaredMime: string; ingestKey: string } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
    findMany?(args: unknown): Promise<{ id: string; ingestKey: string }[]>;
  };
}
export interface MediaDeps {
  db: MediaDb;
  store: ObjectStore;
  buckets: { ingest: string; private: string };
}
export type MediaOutcome = "READY" | "FAILED" | "SKIPPED";

/** A file that can never pass: no retry, the asset is marked FAILED with a reason the owner can see. */
class Reject extends Error {
  constructor(public reason: MediaFailureReason) {
    super(reason);
  }
}

/**
 * Re-encodes an image: rotates by EXIF orientation first, then writes new files from pixel data only, so EXIF/GPS/ICC
 * and any appended payload are dropped (sharp keeps no metadata unless asked to).
 */
export async function buildVariants(input: Buffer) {
  const base = () => sharp(input, { limitInputPixels: MEDIA_MAX_PIXELS, failOn: "error" }).rotate();
  const out: Record<"thumb" | "medium", Buffer> = {} as never;
  for (const [name, px] of Object.entries(MEDIA_VARIANTS) as ["thumb" | "medium", number][]) {
    out[name] = await base().resize({ width: px, height: px, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  }
  const dim = await sharp(out.medium).metadata();
  return { ...out, width: dim.width ?? null, height: dim.height ?? null };
}

/**
 * One media job (idempotent under at-least-once delivery): validate by content -> strip metadata -> variants -> READY.
 * Permanent problems mark FAILED and return; transient (storage/infra) errors throw so BullMQ retries.
 */
export async function processMedia(d: MediaDeps, assetId: string): Promise<MediaOutcome> {
  const a = await d.db.mediaAsset.findUnique({ where: { id: assetId }, select: { id: true, status: true, declaredMime: true, ingestKey: true } });
  if (!a || a.status !== "PROCESSING") return "SKIPPED";
  try {
    let bytes: Buffer | null;
    try {
      bytes = await d.store.get(d.buckets.ingest, a.ingestKey, MEDIA_MAX_BYTES);
    } catch (e) {
      if (e instanceof MediaTooLargeError) throw new Reject("TOO_LARGE");
      throw e;
    }
    if (!bytes) throw new Reject("MISSING_OBJECT");
    const detected = sniffImageMime(bytes);
    if (!detected || !(MEDIA_ALLOWED_MIME as readonly string[]).includes(detected)) throw new Reject("UNSUPPORTED_TYPE");
    if (detected !== a.declaredMime) throw new Reject("TYPE_MISMATCH");
    let v: Awaited<ReturnType<typeof buildVariants>>;
    try {
      v = await buildVariants(bytes);
    } catch (e) {
      throw new Reject(/pixel limit/i.test((e as Error).message) ? "TOO_MANY_PIXELS" : "CORRUPT");
    }
    const thumbKey = variantKey(a.id, "thumb");
    const mediumKey = variantKey(a.id, "medium");
    await d.store.put(d.buckets.private, thumbKey, v.thumb, "image/webp");
    await d.store.put(d.buckets.private, mediumKey, v.medium, "image/webp");
    const res = await d.db.mediaAsset.updateMany({
      where: { id: a.id, status: "PROCESSING" },
      data: { status: "READY", detectedMime: detected, width: v.width, height: v.height, thumbKey, mediumKey, failureReason: null, processedAt: new Date() },
    });
    if (res.count === 1) await d.store.delete(d.buckets.ingest, a.ingestKey); // original (with metadata) is never kept
    return res.count === 1 ? "READY" : "SKIPPED";
  } catch (e) {
    if (!(e instanceof Reject)) throw e;
    await markMediaFailed(d, a.id, e.reason);
    await d.store.delete(d.buckets.ingest, a.ingestKey).catch(() => undefined);
    return "FAILED";
  }
}

/** Surfaces a failure on the asset (also used by the worker when retries are exhausted). */
export async function markMediaFailed(d: Pick<MediaDeps, "db">, assetId: string, reason: MediaFailureReason) {
  await d.db.mediaAsset.updateMany({
    where: { id: assetId, status: { in: ["PROCESSING", "UPLOADING"] } },
    data: { status: "FAILED", failureReason: reason, processedAt: new Date() },
  });
}

/**
 * SEC-03 sweeper: UPLOADING slots older than the presign TTL can no longer receive a PUT, so they are expired
 * (FAILED / UPLOAD_EXPIRED). They keep counting toward the owner's daily quota (createdAt-based). Leftover ingest
 * objects are removed best-effort. Idempotent; the status guard avoids racing a concurrent confirm.
 */
export async function expireStaleUploads(d: MediaDeps, ttlSeconds: number, now: Date = new Date(), batch = 500): Promise<number> {
  const cutoff = new Date(now.getTime() - ttlSeconds * 1000);
  const stale = await d.db.mediaAsset.findMany!({ where: { status: "UPLOADING", createdAt: { lt: cutoff } }, select: { id: true, ingestKey: true }, orderBy: { createdAt: "asc" }, take: batch });
  if (!stale.length) return 0;
  const res = await d.db.mediaAsset.updateMany({
    where: { id: { in: stale.map((a) => a.id) }, status: "UPLOADING", createdAt: { lt: cutoff } },
    data: { status: "FAILED", failureReason: "UPLOAD_EXPIRED" satisfies MediaFailureReason, processedAt: now },
  });
  await Promise.all(stale.map((a) => d.store.delete(d.buckets.ingest, a.ingestKey).catch(() => undefined)));
  return res.count;
}
