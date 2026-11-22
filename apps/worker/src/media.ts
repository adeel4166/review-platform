import sharp from "sharp";
import {
  MEDIA_ALLOWED_MIME,
  MEDIA_ALLOWED_VIDEO_MIME,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_PIXELS,
  MEDIA_MAX_VIDEO_BYTES,
  MEDIA_VARIANTS,
  MediaTooLargeError,
  quarantineKey,
  variantKey,
  type MediaFailureReason,
  type ObjectStore,
} from "@rp/core";
import { ScannerUnavailable, evaluateFreshness, type Scanner } from "./media/clamd";
import { VideoReject, transcodeVideo } from "./media/video";
import { detectType, findPolyglot, sha256Hex } from "./media/validate";
import type { MetadataVerifier } from "./media/verify";

type AssetRow = { id: string; status: string; declaredMime: string; ingestKey: string; sizeBytes?: number };
export interface MediaDb {
  mediaAsset: {
    findUnique(args: unknown): Promise<AssetRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
    findMany?(args: unknown): Promise<{ id: string; ingestKey: string }[]>;
  };
  /** One row per step; scan rows carry engine + signature version (INF-003). Optional so narrow test doubles still work. */
  mediaProcessingLog?: { create(args: unknown): Promise<unknown> };
  bannedMediaHash?: { findUnique(args: unknown): Promise<unknown | null> };
}
export interface MediaDeps {
  db: MediaDb;
  store: ObjectStore;
  buckets: { ingest: string; private: string; public?: string };
  scanner: Scanner;
  verifier: MetadataVerifier;
  /** security-channel alerts (STAGING/metadata defects, PROMOTE_FAILED, DEMOTE_FAILED, CLAMAV_STALE). Never carries file content. */
  alert?: (kind: string, detail: Record<string, unknown>) => void;
  now?: () => Date;
  transcode?: typeof transcodeVideo;
}
export type MediaOutcome = "READY" | "FAILED" | "SKIPPED";

/** A file that can never pass: no retry, the asset is marked FAILED with a reason the owner can see. */
class Reject extends Error {
  constructor(public reason: MediaFailureReason, public alertKind?: string) {
    super(reason);
  }
}

const log = (d: MediaDeps, assetId: string, step: string, outcome: string, extra: { engineVersion?: string; signatureVersion?: string; detail?: Record<string, unknown> } = {}) =>
  d.db.mediaProcessingLog?.create({ data: { assetId, step, outcome, ...extra } }).catch(() => undefined) ?? Promise.resolve();

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
 * One media job (idempotent under at-least-once delivery), strictly in this order, all in memory from ONE read of the
 * ingest object (so there is no second read to swap, U-5):
 *   size/exists -> type by content -> polyglot -> banned hash -> ClamAV -> sanitise/transcode -> verify no metadata -> READY (private).
 * Nothing here writes to the public bucket: only `promoteMedia` does, after moderation approves (MED-037).
 * Permanent problems mark FAILED and return; transient (storage/infra/scanner) errors throw so BullMQ retries.
 */
export async function processMedia(d: MediaDeps, assetId: string): Promise<MediaOutcome> {
  const a = await d.db.mediaAsset.findUnique({ where: { id: assetId }, select: { id: true, status: true, declaredMime: true, ingestKey: true, sizeBytes: true } });
  if (!a || a.status !== "PROCESSING") return "SKIPPED";
  const declaredVideo = (MEDIA_ALLOWED_VIDEO_MIME as readonly string[]).includes(a.declaredMime);
  try {
    let bytes: Buffer | null;
    try {
      bytes = await d.store.get(d.buckets.ingest, a.ingestKey, declaredVideo ? MEDIA_MAX_VIDEO_BYTES : MEDIA_MAX_BYTES);
    } catch (e) {
      if (e instanceof MediaTooLargeError) throw new Reject("TOO_LARGE");
      throw e;
    }
    if (!bytes) throw new Reject("NOT_CONFIRMED");
    if (typeof a.sizeBytes === "number" && bytes.length !== a.sizeBytes) throw new Reject(bytes.length > a.sizeBytes ? "TOO_LARGE" : "TYPE_MISMATCH");
    const detected = detectType(bytes);
    const allowed = [...MEDIA_ALLOWED_MIME, ...MEDIA_ALLOWED_VIDEO_MIME] as readonly string[];
    if (!detected || !allowed.includes(detected.mime)) throw new Reject("UNSUPPORTED_TYPE");
    // Both the kind and the exact type must match what was signed into the presigned PUT.
    if (detected.mime !== a.declaredMime && !(detected.kind === "VIDEO" && declaredVideo)) throw new Reject("TYPE_MISMATCH");
    // Images only: video is fully re-encoded and random video bytes can contain a 4-byte signature by chance.
    const poly = detected.kind === "IMAGE" ? findPolyglot(bytes) : null;
    if (poly) { await log(d, a.id, "VALIDATE", "REJECTED", { detail: { polyglot: poly } }); throw new Reject("TYPE_MISMATCH"); }
    const sha = sha256Hex(bytes);
    await log(d, a.id, "VALIDATE", "OK", { detail: { mime: detected.mime, size: bytes.length } });
    if (await d.db.bannedMediaHash?.findUnique({ where: { sha256: sha } })) { await log(d, a.id, "BANNED_HASH", "REJECTED"); throw new Reject("BANNED_HASH"); }

    // --- ClamAV (INF-003): signatures older than 72 h count as scanner-unavailable (retry, fail closed).
    const ver = await d.scanner.version();
    const fresh = evaluateFreshness(ver, (d.now ?? (() => new Date()))());
    if (fresh.state === "too_old") throw new ScannerUnavailable("scanner: signatures too old");
    if (fresh.state === "stale") d.alert?.("CLAMAV_STALE", { ageHours: Math.round(fresh.ageHours) });
    const res = await d.scanner.scan(bytes); // throws ScannerUnavailable -> retry
    const scanLog = { engineVersion: ver.engine, signatureVersion: ver.signatureVersion };
    if (!res.clean) {
      await log(d, a.id, "VIRUS_SCAN", "INFECTED", { ...scanLog, detail: { threat: res.threat } }); // threat name stays in the log, never shown to the user
      await d.store.put(d.buckets.private, quarantineKey(a.id), bytes, "application/octet-stream");
      throw new Reject("MALWARE");
    }
    await log(d, a.id, "VIRUS_SCAN", "CLEAN", scanLog);
    const scannedAt = (d.now ?? (() => new Date()))();

    // --- Sanitise (re-encode from pixels/frames only) and verify the outputs carry no metadata (MED-042).
    const keys: { thumbKey: string; mediumKey: string; videoKey?: string } = { thumbKey: variantKey(a.id, "thumb"), mediumKey: variantKey(a.id, "medium") };
    let dims: { width: number | null; height: number | null };
    let writes: [string, Buffer, string][];
    let toVerify: [Buffer, "IMAGE" | "VIDEO"][];
    if (detected.kind === "IMAGE") {
      const v = await variantsOrReject(bytes);
      dims = v;
      writes = [[keys.thumbKey, v.thumb, "image/webp"], [keys.mediumKey, v.medium, "image/webp"]];
      toVerify = [[v.thumb, "IMAGE"], [v.medium, "IMAGE"]];
    } else {
      let out;
      try {
        out = await (d.transcode ?? transcodeVideo)(bytes);
      } catch (e) {
        if (e instanceof VideoReject) { await log(d, a.id, "TRANSCODE", "REJECTED", { detail: { subReason: e.subReason ?? null } }); throw new Reject(e.reason); }
        throw e;
      }
      const p = await variantsOrReject(out.poster);
      keys.videoKey = `variants/${a.id}/video.mp4`;
      dims = { width: out.width, height: out.height };
      writes = [[keys.videoKey, out.video, "video/mp4"], [keys.thumbKey, p.thumb, "image/webp"], [keys.mediumKey, p.medium, "image/webp"]];
      toVerify = [[out.video, "VIDEO"], [p.thumb, "IMAGE"], [p.medium, "IMAGE"]];
    }
    for (const [buf, kind] of toVerify) {
      const found = await d.verifier(buf, kind);
      if (found.length) { await log(d, a.id, "SANITISE", "METADATA_FOUND", { detail: { groups: found } }); throw new Reject("PROCESSING_ERROR", "METADATA_VERIFY_FAILED"); }
    }
    await log(d, a.id, "SANITISE", "OK");
    for (const [key, body, type] of writes) await d.store.put(d.buckets.private, key, body, type);
    const upd = await d.db.mediaAsset.updateMany({
      where: { id: a.id, status: "PROCESSING" },
      data: { status: "READY", kind: detected.kind, bucket: "PRIVATE", sha256: sha, virusScannedAt: scannedAt, metadataStripped: true, detectedMime: detected.mime, ...dims, ...keys, failureReason: null, processedAt: scannedAt },
    });
    if (upd.count === 1) await d.store.delete(d.buckets.ingest, a.ingestKey); // the original (with metadata) is never kept
    return upd.count === 1 ? "READY" : "SKIPPED";
  } catch (e) {
    if (!(e instanceof Reject)) throw e;
    if (e.alertKind) d.alert?.(e.alertKind, { assetId: a.id });
    if (e.reason === "MALWARE" || e.reason === "BANNED_HASH") d.alert?.(e.reason, { assetId: a.id });
    await markMediaFailed(d, a.id, e.reason);
    await d.store.delete(d.buckets.ingest, a.ingestKey).catch(() => undefined);
    return "FAILED";
  }
}

async function variantsOrReject(input: Buffer) {
  try {
    return await buildVariants(input);
  } catch (e) {
    throw new Reject(/pixel limit/i.test((e as Error).message) ? "TOO_MANY_PIXELS" : "CORRUPT");
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
export async function expireStaleUploads(d: Pick<MediaDeps, "db" | "store" | "buckets">, ttlSeconds: number, now: Date = new Date(), batch = 500): Promise<number> {
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
