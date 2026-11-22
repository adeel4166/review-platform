import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import type { Env } from "./env";

/** MVP limits (task #32). Images only; every limit is re-checked server-side. */
export const MEDIA_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type MediaMime = (typeof MEDIA_ALLOWED_MIME)[number];
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_ALLOWED_VIDEO_MIME = ["video/mp4", "video/quicktime"] as const;
export const MEDIA_MAX_VIDEO_BYTES = 52_428_800;
export const MEDIA_MAX_VIDEO_SECONDS = 30.5;
export const MEDIA_MAX_VIDEO_SIDE = 4096;
export const MEDIA_MAX_PHOTOS_PER_REVIEW = 10;
export const MEDIA_MAX_VIDEOS_PER_REVIEW = 2;
export const MEDIA_MAX_PER_REVIEW = MEDIA_MAX_PHOTOS_PER_REVIEW + MEDIA_MAX_VIDEOS_PER_REVIEW;
/** ClamAV signature freshness (INF-003): alert above 24 h, scans fail closed above 72 h. */
export const CLAMAV_MAX_SIGNATURE_AGE_HOURS = 24;
export const CLAMAV_HARD_SIGNATURE_AGE_HOURS = 72;
export const MEDIA_MAX_PIXELS = 50_000_000; // decompression-bomb guard
export const MEDIA_PUT_TTL_SECONDS = 600;
export const MEDIA_GET_TTL_SECONDS = 900;
export const MEDIA_VARIANTS = { thumb: 256, medium: 1024 } as const;

export const uploadSlotInput = z
  .object({
    mimeType: z.enum([...MEDIA_ALLOWED_MIME, ...MEDIA_ALLOWED_VIDEO_MIME]),
    sizeBytes: z.number().int().min(1).max(MEDIA_MAX_VIDEO_BYTES),
    /** Video only; used for early refusal. The worker re-checks with ffprobe. */
    durationMs: z.number().int().min(1).max(MEDIA_MAX_VIDEO_SECONDS * 1000).optional(),
  })
  .strict()
  .refine((v) => !(MEDIA_ALLOWED_MIME as readonly string[]).includes(v.mimeType) || v.sizeBytes <= MEDIA_MAX_BYTES, { path: ["sizeBytes"], message: "image too large" });
export const isVideoMime = (m: string) => (MEDIA_ALLOWED_VIDEO_MIME as readonly string[]).includes(m);
export type UploadSlotInput = z.infer<typeof uploadSlotInput>;

/** Server-generated keys only: the client's file name is never used. */
export const ingestKey = (assetId: string) => `in/${assetId}`;
export const variantKey = (assetId: string, v: keyof typeof MEDIA_VARIANTS) => `variants/${assetId}/${v}.webp`;

/** Public keys exist only after promotion (MED-037). */
export const publicKey = (assetId: string, name: string) => `m/${assetId}/${name}`;
export const stagingKey = (assetId: string) => `staging/${assetId}/original`;
export const quarantineKey = (assetId: string) => `quarantine/${assetId}`;
/** Originals held for legal reasons (hash-list match, MED-036); the quarantine retention sweep never touches this prefix. */
export const legalHoldKey = (assetId: string) => `legal-hold/${assetId}`;
export const QUARANTINE_PREFIX = "quarantine/";
export const QUARANTINE_RETENTION_DAYS = 30;

/** Detects the real image type from magic bytes (never trusts the declared type or extension). */
export function sniffImageMime(b: Uint8Array): MediaMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return "image/png";
  const ascii = (from: number, s: string) => [...s].every((c, i) => b[from + i] === c.charCodeAt(0));
  if (b.length >= 12 && ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return null;
}

export type MediaFailureReason = "MALWARE" | "BANNED_HASH" | "SCAN_UNAVAILABLE" | "NOT_CONFIRMED" | "UNSUPPORTED_CODEC" | "TOO_LONG" | "TYPE_MISMATCH" | "UNSUPPORTED_TYPE" | "TOO_LARGE" | "CORRUPT" | "TOO_MANY_PIXELS" | "MISSING_OBJECT" | "PROCESSING_ERROR" | "UPLOAD_EXPIRED";

/** Minimal storage port so web/worker logic is testable with an in-memory fake (no network in tests). */
export interface ObjectStore {
  presignPut(bucket: string, key: string, opts: { contentType: string; contentLength: number; expiresIn: number }): Promise<string>;
  presignGet(bucket: string, key: string, expiresIn: number): Promise<string>;
  head(bucket: string, key: string): Promise<{ size: number } | null>;
  /** Reads at most `maxBytes`; returns null if absent, throws MediaTooLargeError if the object is bigger. */
  get(bucket: string, key: string, maxBytes: number): Promise<Buffer | null>;
  put(bucket: string, key: string, body: Buffer, contentType: string, headers?: ObjectHeaders): Promise<void>;
  delete(bucket: string, key: string): Promise<void>;
  /** Lists objects under a prefix with their last-modified time (retention sweeps, SEC-M5-03). */
  list(bucket: string, prefix: string, limit?: number): Promise<{ key: string; lastModified: Date }[]>;
}

/** Public-object headers (MED-034). */
export interface ObjectHeaders {
  cacheControl?: string;
  contentDisposition?: string;
}

export class MediaTooLargeError extends Error {
  constructor() {
    super("object exceeds size limit");
  }
}

export const mediaBuckets = (env: Pick<Env, "S3_BUCKET_INGEST" | "S3_BUCKET_PRIVATE"> & Partial<Pick<Env, "S3_BUCKET_PUBLIC">>) => ({
  ingest: env.S3_BUCKET_INGEST,
  private: env.S3_BUCKET_PRIVATE,
  public: env.S3_BUCKET_PUBLIC ?? "",
});

/** S3/R2/MinIO implementation. Credentials come only from the validated env. */
export function createS3Store(env: Pick<Env, "S3_ENDPOINT" | "S3_REGION" | "S3_FORCE_PATH_STYLE" | "S3_ACCESS_KEY_ID" | "S3_SECRET_ACCESS_KEY">): ObjectStore {
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  });
  const notFound = (e: unknown) => {
    const x = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    return x.name === "NotFound" || x.name === "NoSuchKey" || x.$metadata?.httpStatusCode === 404;
  };
  return {
    presignPut: (Bucket, Key, o) =>
      getSignedUrl(s3, new PutObjectCommand({ Bucket, Key, ContentType: o.contentType, ContentLength: o.contentLength }), { expiresIn: o.expiresIn, signableHeaders: new Set(["content-type", "content-length"]) }), // MED-025: storage refuses a different type or size
    presignGet: (Bucket, Key, expiresIn) => getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn }),
    async head(Bucket, Key) {
      try {
        const r = await s3.send(new HeadObjectCommand({ Bucket, Key }));
        return { size: r.ContentLength ?? 0 };
      } catch (e) {
        if (notFound(e)) return null;
        throw e;
      }
    },
    async get(Bucket, Key, maxBytes) {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket, Key }));
        if ((r.ContentLength ?? 0) > maxBytes) throw new MediaTooLargeError();
        const chunks: Buffer[] = [];
        let n = 0;
        for await (const c of r.Body as AsyncIterable<Buffer>) {
          n += c.length;
          if (n > maxBytes) throw new MediaTooLargeError();
          chunks.push(c);
        }
        return Buffer.concat(chunks);
      } catch (e) {
        if (notFound(e)) return null;
        throw e;
      }
    },
    async put(Bucket, Key, Body, ContentType, h) {
      await s3.send(new PutObjectCommand({ Bucket, Key, Body, ContentType, ...(h?.cacheControl ? { CacheControl: h.cacheControl } : {}), ...(h?.contentDisposition ? { ContentDisposition: h.contentDisposition } : {}) }));
    },
    async delete(Bucket, Key) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key }));
    },
    async list(Bucket, Prefix, limit = 1000) {
      const out: { key: string; lastModified: Date }[] = [];
      let token: string | undefined;
      do {
        const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken: token }));
        for (const o of r.Contents ?? []) if (o.Key && o.LastModified) out.push({ key: o.Key, lastModified: o.LastModified });
        token = r.IsTruncated && out.length < limit ? r.NextContinuationToken : undefined;
      } while (token);
      return out.slice(0, limit);
    },
  };
}
