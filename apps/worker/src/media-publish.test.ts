import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FakeObjectStore } from "@rp/core";
import { demoteMedia, promoteMedia, reconcilePublication, PUBLIC_HEADERS, type PublishDb } from "./media/publish";

const buckets = { private: "private", public: "public" };

function setup(over: { asset?: Record<string, unknown>; review?: Record<string, unknown>; caseRow?: Record<string, unknown> | null } = {}) {
  const asset: Record<string, unknown> = {
    id: "a1", status: "READY", bucket: "PRIVATE", kind: "IMAGE", virusScannedAt: new Date(), metadataStripped: true, reviewId: "r1",
    attachedInVersion: 1, detachedInVersion: null, thumbKey: "variants/a1/thumb.webp", mediumKey: "variants/a1/medium.webp", videoKey: null, ...over.asset,
  };
  const review = { status: "PUBLISHED", publishedVersion: 1, ...over.review };
  const caseRow = over.caseRow === undefined ? { id: "c1", state: "APPROVED", reviewId: "r1", version: 1 } : over.caseRow;
  const logs: Record<string, unknown>[] = [];
  const db: PublishDb = {
    mediaAsset: {
      findUnique: async () => ({ ...asset, review }) as never,
      findMany: async (a) => ((a as { where: { bucket: string } }).where.bucket === asset.bucket ? [{ ...asset, review } as never] : []),
      updateMany: async (a) => {
        const { where, data } = a as { where: Record<string, unknown>; data: Record<string, unknown> };
        if (Object.entries(where).some(([k, v]) => typeof v !== "object" && asset[k] !== v)) return { count: 0 };
        // The database CHECK from migration 20261220000000_media_pipeline (chk_media_public_bucket, MED-037).
        const next = { ...asset, ...data };
        if (next.bucket === "PUBLIC" && !(next.status === "READY" && next.virusScannedAt && next.metadataStripped === true && next.moderationClearedAt && next.promotedAt)) throw new Error("ER_CHECK_CONSTRAINT_VIOLATED 3819");
        Object.assign(asset, data);
        return { count: 1 };
      },
    },
    moderationCase: { findUnique: async () => caseRow as never, findFirst: async () => (caseRow ? { id: "c1" } : null) },
    mediaProcessingLog: { create: async (a) => { logs.push((a as { data: Record<string, unknown> }).data); } },
  };
  const store = new FakeObjectStore();
  store.objects.set("private/variants/a1/thumb.webp", Buffer.from("T"));
  store.objects.set("private/variants/a1/medium.webp", Buffer.from("M"));
  const purged: string[][] = [];
  const cdn = { purgeUrls: async (u: string[]) => { purged.push(u); } };
  return { asset, review, store, logs, purged, deps: { db, store, buckets, cdn, publicBaseUrl: "https://media.example/" } };
}
const keys = (s: FakeObjectStore, prefix: string) => [...s.objects.keys()].filter((k) => k.startsWith(prefix)).sort();

describe("MED-037 / MED-044: promotion only after scan + sanitise + approved moderation", () => {
  it("approved + published + visible -> copied to public with MED-034 headers, DB flips, private copies removed", async () => {
    const t = setup();
    expect(await promoteMedia(t.deps, "a1", "c1")).toBe("PROMOTED");
    expect(t.asset).toMatchObject({ bucket: "PUBLIC", thumbKey: "m/a1/thumb.webp", mediumKey: "m/a1/medium.webp" });
    expect(t.asset.moderationClearedAt).toBeInstanceOf(Date);
    expect(keys(t.store, "public/")).toEqual(["public/m/a1/medium.webp", "public/m/a1/thumb.webp"]);
    expect(keys(t.store, "private/")).toEqual([]);
    expect(t.store.meta.get("public/m/a1/thumb.webp")).toEqual({ contentType: "image/webp", headers: PUBLIC_HEADERS });
    expect(await promoteMedia(t.deps, "a1", "c1")).toBe("SKIPPED"); // idempotent
  });

  it.each([
    ["not scanned", { asset: { virusScannedAt: null } }],
    ["metadata not verified", { asset: { metadataStripped: false } }],
    ["asset still PROCESSING", { asset: { status: "PROCESSING" } }],
    ["review not PUBLISHED (pending)", { review: { status: "PENDING", publishedVersion: null } }],
    ["review hidden", { review: { status: "HIDDEN" } }],
    ["asset staged (attachedInVersion NULL)", { asset: { attachedInVersion: null } }],
    ["asset attached after the published version", { asset: { attachedInVersion: 2 } }],
    ["asset detached by an edit", { asset: { detachedInVersion: 1 } }],
    ["case not approved", { caseRow: { id: "c1", state: "NEEDS_HUMAN", reviewId: "r1", version: 1 } }],
    ["case for a stale version", { caseRow: { id: "c1", state: "APPROVED", reviewId: "r1", version: 0 } }],
    ["case for another review", { caseRow: { id: "c1", state: "APPROVED", reviewId: "r2", version: 1 } }],
    ["no case", { caseRow: null }],
  ])("MED-044: refuses when %s, bucket unchanged and nothing public", async (_n, over) => {
    const t = setup(over);
    expect(await promoteMedia(t.deps, "a1", "c1")).toBe("SKIPPED");
    expect(t.asset.bucket).toBe("PRIVATE");
    expect(keys(t.store, "public/")).toEqual([]);
    expect(keys(t.store, "private/")).toHaveLength(2);
  });

  it("MED-037: the DB CHECK rejects a raw update that makes an asset public without scan or moderation clearance", async () => {
    const t = setup({ asset: { virusScannedAt: null } });
    await expect(t.deps.db.mediaAsset.updateMany({ where: { id: "a1" }, data: { bucket: "PUBLIC" } })).rejects.toThrow(/3819/);
    const u = setup();
    await expect(u.deps.db.mediaAsset.updateMany({ where: { id: "a1" }, data: { bucket: "PUBLIC", promotedAt: new Date() } })).rejects.toThrow(/3819/); // no moderationClearedAt
  });

  it("a failed copy leaves nothing public and the asset PRIVATE (retry later)", async () => {
    const t = setup();
    const put = t.store.put.bind(t.store);
    t.store.put = async (b, k, ...r) => { if (k.endsWith("medium.webp")) throw new Error("R2 down"); return put(b, k, ...r); };
    await expect(promoteMedia(t.deps, "a1", "c1")).rejects.toThrow("R2 down");
    expect(t.asset.bucket).toBe("PRIVATE");
    expect(keys(t.store, "public/")).toEqual([]);
  });
});

describe("MED-029 / MED-045: demote", () => {
  it("public -> private: private copy restored, public deleted, flags cleared, CDN purged", async () => {
    const t = setup();
    await promoteMedia(t.deps, "a1", "c1");
    expect(await demoteMedia(t.deps, "a1", "REVIEW_REMOVED")).toBe("DEMOTED");
    expect(t.asset).toMatchObject({ bucket: "PRIVATE", moderationClearedAt: null, promotedAt: null, thumbKey: "variants/a1/thumb.webp" });
    expect(keys(t.store, "public/")).toEqual([]);
    expect(keys(t.store, "private/")).toHaveLength(2);
    expect(t.purged.flat().sort()).toEqual(["https://media.example/m/a1/medium.webp", "https://media.example/m/a1/thumb.webp"]);
  });

  it("idempotent: a retry after the public delete completes; an already-private asset still gets the CDN purge", async () => {
    const t = setup();
    await promoteMedia(t.deps, "a1", "c1");
    // crash window: public objects deleted, DB still says PUBLIC, private copies exist
    for (const n of ["thumb", "medium"]) { t.store.objects.set(`private/variants/a1/${n}.webp`, Buffer.from(n)); t.store.objects.delete(`public/m/a1/${n}.webp`); }
    expect(await demoteMedia(t.deps, "a1", "X")).toBe("DEMOTED");
    expect(t.asset.bucket).toBe("PRIVATE");
    expect(await demoteMedia(t.deps, "a1", "X")).toBe("PURGE_ONLY");
    expect(t.purged).toHaveLength(2);
  });

  it("a CDN purge failure raises DEMOTE_FAILED but content is already private", async () => {
    const t = setup();
    await promoteMedia(t.deps, "a1", "c1");
    const alerts: string[] = [];
    await expect(demoteMedia({ ...t.deps, cdn: { purgeUrls: async () => { throw new Error("cf down"); } }, alert: (k) => alerts.push(k) }, "a1", "X")).rejects.toThrow("cf down");
    expect(alerts).toEqual(["DEMOTE_FAILED"]);
    expect(keys(t.store, "public/")).toEqual([]);
  });
});

describe("reconcilePublication (safety net for events that never arrived)", () => {
  it("demotes public media whose review is no longer PUBLISHED; promotes approved private media", async () => {
    const t = setup();
    expect(await reconcilePublication(t.deps)).toEqual({ demoted: 0, promoted: 1 });
    t.review.status = "REMOVED";
    expect(await reconcilePublication(t.deps)).toEqual({ demoted: 1, promoted: 0 });
    expect(t.asset.bucket).toBe("PRIVATE");
    expect(keys(t.store, "public/")).toEqual([]);
    expect(await reconcilePublication(t.deps)).toEqual({ demoted: 0, promoted: 0 }); // removed review is not re-promoted
  });
});

describe("MED-028 promote: sha256 verified, public objects are never overwritten", () => {
  const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
  it("the public copy is byte-identical (sha256) to the private source", async () => {
    const t = setup();
    expect(await promoteMedia(t.deps, "a1", "c1")).toBe("PROMOTED");
    expect(sha(t.store.objects.get("public/m/a1/thumb.webp")!)).toBe(sha("T"));
    expect(sha(t.store.objects.get("public/m/a1/medium.webp")!)).toBe(sha("M"));
  });
  it("an existing public object with DIFFERENT bytes is not overwritten: promotion throws, nothing else leaks, DB stays PRIVATE", async () => {
    const t = setup();
    t.store.objects.set("public/m/a1/medium.webp", Buffer.from("EVIL"));
    await expect(promoteMedia(t.deps, "a1", "c1")).rejects.toThrow(/no-overwrite/);
    expect(t.store.objects.get("public/m/a1/medium.webp")!.toString()).toBe("EVIL"); // untouched
    expect(keys(t.store, "public/")).toEqual(["public/m/a1/medium.webp"]); // the thumb we wrote was rolled back, the pre-existing object kept
    expect(t.asset.bucket).toBe("PRIVATE");
  });
  it("an existing public object with identical bytes (crash retry) is reused without a second put", async () => {
    const t = setup();
    t.store.objects.set("public/m/a1/thumb.webp", Buffer.from("T"));
    t.store.meta.set("public/m/a1/thumb.webp", { contentType: "image/webp", headers: PUBLIC_HEADERS });
    expect(await promoteMedia(t.deps, "a1", "c1")).toBe("PROMOTED");
    expect(t.asset.bucket).toBe("PUBLIC");
  });
  it("a copy whose read-back hash differs aborts and removes what this call wrote", async () => {
    const t = setup();
    const realPut = t.store.put.bind(t.store);
    t.store.put = async (b, k, body, ct, h) => realPut(b, k, Buffer.concat([body, Buffer.from("!")]), ct, h); // corrupting store
    await expect(promoteMedia(t.deps, "a1", "c1")).rejects.toThrow(/sha256 mismatch/);
    expect(keys(t.store, "public/")).toEqual([]);
    expect(t.asset.bucket).toBe("PRIVATE");
  });
});

describe("QA-M5-12: infra/cdn/media-headers.json", () => {
  const cfg = JSON.parse(readFileSync(new URL("../../../infra/cdn/media-headers.json", import.meta.url), "utf8")) as { match: { pathPrefix: string }; headers: Record<string, string> };
  it("sends nosniff and a sandboxing CSP for the public media prefix", () => {
    expect(cfg.match.pathPrefix).toBe("/m/");
    expect(cfg.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(cfg.headers["Content-Security-Policy"]).toMatch(/(^|;\s*)sandbox(\s*;|$)/);
    expect(cfg.headers["Content-Security-Policy"]).toContain("default-src 'none'");
  });
  it("agrees with the object headers the worker writes (cache + inline)", () => {
    expect(cfg.headers["Cache-Control"]).toBe(PUBLIC_HEADERS.cacheControl);
    expect(cfg.headers["Content-Disposition"]).toBe(PUBLIC_HEADERS.contentDisposition);
  });
});
