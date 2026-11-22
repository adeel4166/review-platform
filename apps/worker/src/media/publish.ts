import { publicKey, type ObjectStore, systemClock } from "@rp/core";

/** `CdnPurger` (m4-m5-spec 10.2): production = Cloudflare zone purge; dev/CI = a recording fake. */
export interface CdnPurger {
  purgeUrls(urls: string[]): Promise<void>;
}

interface PublishRow {
  id: string;
  status: string;
  bucket: "INGEST" | "PRIVATE" | "PUBLIC";
  kind: "IMAGE" | "VIDEO";
  virusScannedAt: Date | null;
  metadataStripped: boolean;
  reviewId: string;
  attachedInVersion: number | null;
  detachedInVersion: number | null;
  thumbKey: string | null;
  mediumKey: string | null;
  videoKey: string | null;
  review: { status: string; publishedVersion: number | null };
}
export interface PublishDb {
  mediaAsset: {
    findUnique(args: unknown): Promise<PublishRow | null>;
    findMany?(args: unknown): Promise<(PublishRow)[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  moderationCase: {
    findUnique(args: unknown): Promise<{ state: string; reviewId: string | null; version: number } | null>;
    findFirst?(args: unknown): Promise<{ id: string } | null>;
  };
  mediaProcessingLog?: { create(args: unknown): Promise<unknown> };
}
export interface PublishDeps {
  db: PublishDb;
  store: ObjectStore;
  buckets: { private: string; public: string };
  cdn: CdnPurger;
  publicBaseUrl: string;
  now?: () => Date;
  alert?: (kind: string, detail: Record<string, unknown>) => void;
}

const select = { id: true, status: true, bucket: true, kind: true, virusScannedAt: true, metadataStripped: true, reviewId: true, attachedInVersion: true, detachedInVersion: true, thumbKey: true, mediumKey: true, videoKey: true, review: { select: { status: true, publishedVersion: true } } };
const keyFields = ["thumbKey", "mediumKey", "videoKey"] as const;
/** Fixed object names, so private and public keys map to each other without a variants column. */
const NAME: Record<(typeof keyFields)[number], string> = { thumbKey: "thumb.webp", mediumKey: "medium.webp", videoKey: "video.mp4" };
const TYPE: Record<string, string> = { "thumb.webp": "image/webp", "medium.webp": "image/webp", "video.mp4": "video/mp4" };
const privateKeyOf = (id: string, name: string) => `variants/${id}/${name}`;
/** MED-034: type from our table, long immutable cache, inline, no file name. nosniff + CSP sandbox are CDN response-header rules. */
export const PUBLIC_HEADERS = { cacheControl: "public, max-age=31536000, immutable", contentDisposition: "inline" } as const;

const wrote = (d: PublishDeps, assetId: string, step: string, outcome: string, detail?: Record<string, unknown>) =>
  d.db.mediaProcessingLog?.create({ data: { assetId, step, outcome, ...(detail ? { detail } : {}) } }).catch(() => undefined) ?? Promise.resolve();

/** Pure gate (m4-m5-spec 10.1 minus the moderation field, which promote sets itself). */
export function promotable(a: PublishRow, approved: { state: string; reviewId: string | null; version: number } | null): string | null {
  if (a.status !== "READY") return "not_ready";
  if (!a.virusScannedAt) return "not_scanned";
  if (!a.metadataStripped) return "not_sanitised";
  if (a.review.status !== "PUBLISHED" || a.review.publishedVersion == null) return "review_not_published";
  const v = a.review.publishedVersion;
  if (a.attachedInVersion == null || a.attachedInVersion > v || (a.detachedInVersion != null && a.detachedInVersion <= v)) return "not_visible_in_published_version";
  if (!approved || approved.state !== "APPROVED" || approved.reviewId !== a.reviewId || approved.version !== v) return "case_not_approved";
  return null;
}

/** `media.promote`: re-reads everything, then copies private -> public. Any failed guard is a logged no-op (bucket unchanged). */
export async function promoteMedia(d: PublishDeps, assetId: string, caseId: string): Promise<"PROMOTED" | "SKIPPED"> {
  const a = await d.db.mediaAsset.findUnique({ where: { id: assetId }, select });
  if (!a || a.bucket !== "PRIVATE") return "SKIPPED"; // unknown, still ingest, or already public (idempotent)
  const c = await d.db.moderationCase.findUnique({ where: { id: caseId }, select: { state: true, reviewId: true, version: true } });
  const why = promotable(a, c);
  if (why) { await wrote(d, a.id, "PROMOTE", "SKIPPED", { why }); return "SKIPPED"; }
  const next: Record<string, string> = {};
  try {
    for (const f of keyFields) {
      const src = a[f];
      if (!src) continue;
      const name = NAME[f];
      const body = await d.store.get(d.buckets.private, src, 60 * 1024 * 1024);
      if (!body) throw new Error("private object missing");
      const dest = publicKey(a.id, name);
      await d.store.put(d.buckets.public, dest, body, TYPE[name]!, PUBLIC_HEADERS);
      if (!(await d.store.head(d.buckets.public, dest))) throw new Error("public copy not visible");
      next[f] = dest;
    }
  } catch (e) {
    for (const k of Object.values(next)) await d.store.delete(d.buckets.public, k).catch(() => undefined); // never leave a half-public asset
    throw e; // BullMQ retries; the final failure raises PROMOTE_FAILED
  }
  const now = (d.now ?? (() => systemClock.now()))();
  const res = await d.db.mediaAsset.updateMany({ where: { id: a.id, status: "READY", bucket: "PRIVATE" }, data: { bucket: "PUBLIC", promotedAt: now, moderationClearedAt: now, ...next } });
  if (res.count !== 1) {
    for (const k of Object.values(next)) await d.store.delete(d.buckets.public, k).catch(() => undefined);
    return "SKIPPED";
  }
  for (const f of keyFields) if (a[f]) await d.store.delete(d.buckets.private, a[f]!).catch(() => undefined);
  await wrote(d, a.id, "PROMOTE", "OK");
  return "PROMOTED";
}

/**
 * `media.demote`: idempotent and crash-safe. Order: private copy exists -> delete public objects (origin first) -> DB flips to
 * PRIVATE -> CDN purge. Already private: skip the first three, the purge still runs (MED-045).
 */
export async function demoteMedia(d: PublishDeps, assetId: string, reason: string): Promise<"DEMOTED" | "PURGE_ONLY" | "SKIPPED"> {
  const a = await d.db.mediaAsset.findUnique({ where: { id: assetId }, select });
  if (!a) return "SKIPPED";
  const names = keyFields.filter((f) => a[f]).map((f) => NAME[f]);
  const urls = names.map((n) => `${d.publicBaseUrl.replace(/\/$/, "")}/${publicKey(a.id, n)}`);
  if (a.bucket === "PUBLIC") {
    for (const n of names) {
      const priv = privateKeyOf(a.id, n);
      if (await d.store.head(d.buckets.private, priv)) continue;
      const body = await d.store.get(d.buckets.public, publicKey(a.id, n), 60 * 1024 * 1024);
      if (!body) continue; // a previous partial demote already removed the public copy and the private one exists
      await d.store.put(d.buckets.private, priv, body, TYPE[n]!);
    }
    for (const n of names) await d.store.delete(d.buckets.public, publicKey(a.id, n));
    const next: Record<string, string> = {};
    for (const f of keyFields) if (a[f]) next[f] = privateKeyOf(a.id, NAME[f]);
    await d.db.mediaAsset.updateMany({ where: { id: a.id, bucket: "PUBLIC" }, data: { bucket: "PRIVATE", moderationClearedAt: null, promotedAt: null, ...next } });
  } else if (a.bucket !== "PRIVATE") {
    return "SKIPPED"; // never public
  }
  const wasPublic = a.bucket === "PUBLIC";
  try {
    await d.cdn.purgeUrls(urls);
  } catch (e) {
    d.alert?.("DEMOTE_FAILED", { assetId: a.id, reason }); // content is already private; the CDN may still serve cached bytes: page someone
    throw e;
  }
  await wrote(d, a.id, "DEMOTE", wasPublic ? "OK" : "PURGE_ONLY", { reason });
  return wasPublic ? "DEMOTED" : "PURGE_ONLY";
}

/**
 * Safety net for every path that changes a review's visibility without emitting an event (user delete T13/T17, report removal,
 * staff hide, an edit that detaches media, a lost outbox row). Demotes any public asset whose review is no longer PUBLISHED or
 * whose version no longer shows it; promotes READY private assets whose published version has an APPROVED case. Idempotent.
 */
export async function reconcilePublication(d: PublishDeps, batch = 100): Promise<{ demoted: number; promoted: number }> {
  let demoted = 0, promoted = 0;
  const pub = (await d.db.mediaAsset.findMany?.({ where: { bucket: "PUBLIC" }, select, take: batch, orderBy: { updatedAt: "asc" } })) ?? [];
  for (const a of pub) {
    const v = a.review.publishedVersion;
    const visible = a.review.status === "PUBLISHED" && v != null && a.attachedInVersion != null && a.attachedInVersion <= v && (a.detachedInVersion == null || a.detachedInVersion > v);
    if (!visible) { await demoteMedia(d, a.id, "RECONCILE"); demoted++; }
  }
  const priv = (await d.db.mediaAsset.findMany?.({ where: { bucket: "PRIVATE", status: "READY", review: { status: "PUBLISHED" } }, select, take: batch, orderBy: { updatedAt: "asc" } })) ?? [];
  for (const a of priv) {
    const v = a.review.publishedVersion;
    if (v == null) continue;
    const c = await d.db.moderationCase.findFirst?.({ where: { reviewId: a.reviewId, version: v, state: "APPROVED" }, select: { id: true }, orderBy: { decidedAt: "desc" } });
    if (c && (await promoteMedia(d, a.id, c.id)) === "PROMOTED") promoted++;
  }
  return { demoted, promoted };
}
