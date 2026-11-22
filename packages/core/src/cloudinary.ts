import { createHash } from "node:crypto";
import { MediaTooLargeError, type ObjectHeaders, type ObjectStore } from "./media";

/**
 * Cloudinary as the PUBLIC media tier (CDN delivery with automatic format/quality).
 *
 * Only the public bucket is routed here: ingest, quarantine, legal-hold and private variants stay in S3/MinIO, so nothing
 * reaches Cloudinary before ClamAV, sanitising and moderation approval (MED-037). Keys like `m/<id>/medium.webp` become
 * public_id `m/<id>/medium` with resource_type image|video. The API secret is used only to sign requests; it is never logged.
 */
export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  fetch?: typeof fetch;
}

const API = "https://api.cloudinary.com/v1_1";
const RES = "https://res.cloudinary.com";

/** Delivery transformations: f_auto/q_auto pick AVIF/WebP and quality per browser; video gets the best codec per client. */
export const CLOUDINARY_IMAGE_TX = "f_auto,q_auto";
export const CLOUDINARY_VIDEO_TX = "q_auto,vc_auto";

export function splitCloudinaryKey(key: string): { publicId: string; ext: string; resourceType: "image" | "video" } {
  const dot = key.lastIndexOf(".");
  const ext = dot > key.lastIndexOf("/") ? key.slice(dot + 1).toLowerCase() : "";
  const publicId = ext ? key.slice(0, dot) : key;
  return { publicId, ext, resourceType: ext === "mp4" || ext === "mov" || ext === "webm" ? "video" : "image" };
}

/** Optimised public URL for a public key. */
export function cloudinaryDeliveryUrl(cloudName: string, key: string): string {
  const { publicId, ext, resourceType } = splitCloudinaryKey(key);
  const tx = resourceType === "video" ? CLOUDINARY_VIDEO_TX : CLOUDINARY_IMAGE_TX;
  return `${RES}/${cloudName}/${resourceType}/upload/${tx}/${publicId}${ext ? `.${ext}` : ""}`;
}

/** Cloudinary request signature: sorted `k=v` pairs joined by `&`, then the secret, SHA-1. */
export function cloudinarySignature(params: Record<string, string>, apiSecret: string): string {
  const s = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return createHash("sha1").update(s + apiSecret).digest("hex");
}

export function cloudinaryConfigFromEnv(env: Record<string, string | undefined> = process.env): CloudinaryConfig | null {
  if (env.MEDIA_PUBLIC_STORE !== "cloudinary") return null;
  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = env;
  if (!cloudName || !apiKey || !apiSecret) throw new Error("MEDIA_PUBLIC_STORE=cloudinary needs CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET");
  return { cloudName, apiKey, apiSecret };
}

export function createCloudinaryStore(cfg: CloudinaryConfig): ObjectStore {
  const f = cfg.fetch ?? fetch;
  const auth = "Basic " + Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString("base64");
  const fail = async (what: string, r: Response) => {
    const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
    return new Error(`cloudinary ${what} failed: HTTP ${r.status} ${body?.error?.message ?? ""}`.trim());
  };
  /** Admin API lookup (not the CDN, so a 404 is never cached between "does it exist" and "is it there now"). */
  const resource = async (key: string) => {
    const { publicId, resourceType } = splitCloudinaryKey(key);
    const r = await f(`${API}/${cfg.cloudName}/resources/${resourceType}/upload/${publicId.split("/").map(encodeURIComponent).join("/")}`, { headers: { authorization: auth } });
    if (r.status === 404) return null;
    if (!r.ok) throw await fail("lookup", r);
    return (await r.json()) as { bytes: number; secure_url: string };
  };
  const signed = (params: Record<string, string>) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const p = { ...params, timestamp };
    return { ...p, api_key: cfg.apiKey, signature: cloudinarySignature(p, cfg.apiSecret) };
  };
  const unsupported = () => Promise.reject(new Error("cloudinary public store: presigned URLs are not used for the public tier"));
  return {
    presignPut: unsupported,
    presignGet: unsupported,
    async head(_bucket, key) {
      const r = await resource(key);
      return r ? { size: r.bytes } : null;
    },
    async get(_bucket, key, maxBytes) {
      const meta = await resource(key);
      if (!meta) return null;
      if (meta.bytes > maxBytes) throw new MediaTooLargeError();
      // secure_url carries the version segment, so it is a fresh CDN cache key and returns the stored original untouched.
      const r = await f(meta.secure_url);
      if (!r.ok) throw await fail("download", r);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > maxBytes) throw new MediaTooLargeError();
      return buf;
    },
    async put(_bucket, key, body, contentType, _h?: ObjectHeaders) {
      const { publicId, resourceType } = splitCloudinaryKey(key);
      const params: Record<string, string> = { public_id: publicId, overwrite: "false", unique_filename: "false", use_filename: "false" };
      // Pre-build the optimised video rendition so the first viewer does not wait for it.
      if (resourceType === "video") Object.assign(params, { eager: CLOUDINARY_VIDEO_TX, eager_async: "true" });
      const form = new FormData();
      for (const [k, v] of Object.entries(signed(params))) form.append(k, v);
      form.append("file", new Blob([new Uint8Array(body)], { type: contentType }), "upload");
      const r = await f(`${API}/${cfg.cloudName}/${resourceType}/upload`, { method: "POST", body: form });
      if (!r.ok) throw await fail("upload", r);
    },
    async delete(_bucket, key) {
      const { publicId, resourceType } = splitCloudinaryKey(key);
      const form = new FormData();
      // invalidate=true also purges the CDN copies, so a demoted asset stops being served.
      for (const [k, v] of Object.entries(signed({ public_id: publicId, invalidate: "true" }))) form.append(k, v);
      const r = await f(`${API}/${cfg.cloudName}/${resourceType}/destroy`, { method: "POST", body: form });
      if (!r.ok) throw await fail("delete", r);
    },
    async list(_bucket, prefix, limit = 500) {
      const out: { key: string; lastModified: Date }[] = [];
      for (const rt of ["image", "video"] as const) {
        let cursor: string | undefined;
        do {
          const q = new URLSearchParams({ type: "upload", prefix, max_results: "500", ...(cursor ? { next_cursor: cursor } : {}) });
          const r = await f(`${API}/${cfg.cloudName}/resources/${rt}?${q}`, { headers: { authorization: auth } });
          if (!r.ok) throw await fail("list", r);
          const j = (await r.json()) as { resources: { public_id: string; format: string; created_at: string }[]; next_cursor?: string };
          for (const x of j.resources) out.push({ key: `${x.public_id}.${x.format}`, lastModified: new Date(x.created_at) });
          cursor = out.length < limit ? j.next_cursor : undefined;
        } while (cursor);
      }
      return out.slice(0, limit);
    },
  };
}

/** Sends the public bucket to `publicStore`, everything else to `base`. */
export function routePublicBucket(base: ObjectStore, publicBucket: string, publicStore: ObjectStore): ObjectStore {
  const pick = (b: string) => (b === publicBucket ? publicStore : base);
  return {
    presignPut: (b, k, o) => pick(b).presignPut(b, k, o),
    presignGet: (b, k, e) => pick(b).presignGet(b, k, e),
    head: (b, k) => pick(b).head(b, k),
    get: (b, k, m) => pick(b).get(b, k, m),
    put: (b, k, body, t, h) => pick(b).put(b, k, body, t, h),
    delete: (b, k) => pick(b).delete(b, k),
    list: (b, p, l) => pick(b).list(b, p, l),
  };
}
