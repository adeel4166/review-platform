import { describe, expect, it, vi } from "vitest";
import { FakeObjectStore } from "@rp/core";
import { confirmUpload, createUploadSlot, readyMediaUrls, type Storage } from "./media";
import type { Db } from "./db";

const input = { mimeType: "image/png" as const, sizeBytes: 1000 };
function setup(over: { count?: number; review?: unknown; asset?: unknown } = {}) {
  const tx = { mediaAsset: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "m1", status: "PROCESSING" }) }, outboxEvent: { create: vi.fn() } };
  const m = {
    review: { findFirst: vi.fn().mockResolvedValue("review" in over ? over.review : { id: "r1", status: "PENDING" }) },
    mediaAsset: {
      count: vi.fn().mockResolvedValue(over.count ?? 0),
      create: vi.fn().mockResolvedValue({ id: "m1" }),
      update: vi.fn(),
      findFirst: vi.fn().mockResolvedValue("asset" in over ? over.asset : { id: "m1", status: "UPLOADING", sizeBytes: 1000, ingestKey: "in/m1", review: { status: "PENDING" } }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "m1", status: "FAILED" }),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const store = new FakeObjectStore();
  const st: Storage = { store, buckets: { ingest: "ingest", private: "private" }, publicBaseUrl: "https://cdn.example" };
  return { db: m as unknown as Db, m, tx, store, st };
}

describe("createUploadSlot", () => {
  it("issues a presigned PUT bound to the declared type and size", async () => {
    const { db, st, m } = setup();
    const r = await createUploadSlot(db, st, "u1", "r1", input);
    expect(r.uploadUrl).toContain("ingest/in/m1");
    expect(r.uploadUrl).toContain("len=1000");
    expect(m.mediaAsset.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { ingestKey: "in/m1" } });
  });
  it("404s for someone else's review and 409s at 10 photos", async () => {
    const a = setup({ review: null });
    await expect(createUploadSlot(a.db, a.st, "u2", "r1", input)).rejects.toMatchObject({ status: 404 });
    const b = setup({ count: 10 });
    await expect(createUploadSlot(b.db, b.st, "u1", "r1", input)).rejects.toMatchObject({ status: 409, code: "media_limit" });
    expect(b.m.mediaAsset.create).not.toHaveBeenCalled();
  });
});

describe("video slots (M5)", () => {
  const video = { mimeType: "video/mp4" as const, sizeBytes: 30 * 1024 * 1024, durationMs: 20_000 };
  it("allows a video up to 50 MiB (images stay at 10 MiB) and caps videos at 2 per review", async () => {
    const a = setup();
    expect((await createUploadSlot(a.db, a.st, "u1", "r1", video)).headers["Content-Type"]).toBe("video/mp4");
    const b = setup({ count: 2 });
    await expect(createUploadSlot(b.db, b.st, "u1", "r1", video)).rejects.toMatchObject({ status: 409, code: "media_limit" });
    const c = setup();
    await expect(createUploadSlot(c.db, c.st, "u1", "r1", { ...input, sizeBytes: 11 * 1024 * 1024 })).rejects.toMatchObject({ status: 413 });
  });
  it("the slot schema refuses oversized images, >30.5 s videos and unsupported types (GIF, WebM)", async () => {
    const { uploadSlotInput } = await import("@rp/core");
    expect(uploadSlotInput.safeParse({ mimeType: "image/png", sizeBytes: 11 * 1024 * 1024 }).success).toBe(false);
    expect(uploadSlotInput.safeParse({ ...video, durationMs: 31_000 }).success).toBe(false);
    expect(uploadSlotInput.safeParse({ mimeType: "image/gif", sizeBytes: 10 }).success).toBe(false);
    expect(uploadSlotInput.safeParse({ mimeType: "video/webm", sizeBytes: 10 }).success).toBe(false);
  });
});

describe("media on non-PENDING reviews (SEC-02)", () => {
  it.each(["REJECTED", "HIDDEN"])("409s a slot on a %s review", async (status) => {
    const { db, st, m } = setup({ review: { id: "r1", status } });
    await expect(createUploadSlot(db, st, "u1", "r1", input)).rejects.toMatchObject({ status: 409 });
    expect(m.mediaAsset.create).not.toHaveBeenCalled();
  });
  it.each(["REJECTED", "HIDDEN"])("409s confirm when the review is %s", async (status) => {
    const { db, st, tx } = setup({ asset: { id: "m1", status: "UPLOADING", sizeBytes: 1000, ingestKey: "in/m1", review: { status } } });
    await expect(confirmUpload(db, st, "u1", "m1")).rejects.toMatchObject({ status: 409 });
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
  it("REV-007: only assets visible in the published version are public (staged, later and detached ones are not)", async () => {
    const { db, st, m } = setup();
    const row = (id: string, attachedInVersion: number | null, detachedInVersion: number | null) => ({ id, reviewId: "r1", createdAt: new Date(), width: 1, height: 1, thumbKey: "t", mediumKey: "md", attachedInVersion, detachedInVersion, review: { publishedAt: new Date(), publishedVersion: 2 } });
    m.mediaAsset.findMany.mockResolvedValue([row("old", 1, null), row("staged", null, null), row("future", 3, null), row("detached", 1, 2), row("detachedLater", 1, 3)]);
    const out = await readyMediaUrls(db, st, ["r1"]);
    expect(out.get("r1")?.map((i) => i.id)).toEqual(["old", "detachedLater"]);
  });
  it("PUBLISHED review: a slot is issued as staged (attachedInVersion NULL) until an edit claims it", async () => {
    const { db, st, m } = setup({ review: { id: "r1", status: "PUBLISHED", currentVersion: 3 } });
    await createUploadSlot(db, st, "u1", "r1", input);
    expect(m.mediaAsset.create.mock.calls[0]![0].data).toMatchObject({ attachedInVersion: null });
  });
});

describe("confirmUpload (ADR-0023: no storage access, INF-002)", () => {
  const asset = (createdAt = new Date()) => ({ id: "m1", status: "UPLOADING", createdAt, review: { status: "PENDING" } });
  it("moves to PROCESSING and enqueues via the outbox without calling HEAD/GET on storage", async () => {
    const { db, st, store, tx } = setup({ asset: asset() });
    const spy = vi.spyOn(store, "head");
    const get = vi.spyOn(store, "get");
    await confirmUpload(db, st, "u1", "m1");
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "media.uploaded", payload: { assetId: "m1" } }) });
    expect(spy).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
  it("an expired slot is 409 slot_expired and nothing is enqueued", async () => {
    const { db, st, tx } = setup({ asset: asset(new Date(Date.now() - 11 * 60_000)) });
    await expect(confirmUpload(db, st, "u1", "m1")).rejects.toMatchObject({ status: 409, code: "slot_expired" });
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
  it("a repeat confirm returns the current status with no new event", async () => {
    const { db, st, tx } = setup({ asset: { ...asset(), status: "PROCESSING" } });
    await confirmUpload(db, st, "u1", "m1");
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
  it("404s for another user's asset", async () => {
    const { db, st } = setup({ asset: null });
    await expect(confirmUpload(db, st, "u2", "m1")).rejects.toMatchObject({ status: 404 });
  });
});

describe("readyMediaUrls", () => {
  it("queries only READY media of PUBLISHED reviews", async () => {
    const { db, st, m } = setup();
    m.mediaAsset.findMany.mockResolvedValue([{ id: "m1", reviewId: "r1", width: 10, height: 10, thumbKey: "m/m1/thumb.webp", mediumKey: "m/m1/medium.webp", createdAt: new Date("2026-01-01"), attachedInVersion: 1, detachedInVersion: null, review: { publishedAt: new Date("2026-01-02"), publishedVersion: 1 } }]);
    const out = await readyMediaUrls(db, st, ["r1"]);
    expect((m.mediaAsset.findMany.mock.calls[0]?.[0] as { where: unknown }).where).toMatchObject({ status: "READY", bucket: "PUBLIC", review: { status: "PUBLISHED" } });
    expect(out.get("r1")?.[0]?.thumbUrl).toBe("https://cdn.example/m/m1/thumb.webp"); // public CDN URL, never a signed GET
  });
});

describe("upload quota (SEC-03)", () => {
  it("429s once the 24h quota (FAILED included) is used, and creates nothing", async () => {
    const { db, st, m } = setup({ count: 3 });
    await expect(createUploadSlot(db, st, "u1", "r1", input, 3)).rejects.toMatchObject({ status: 429, code: "upload_quota", headers: { "Retry-After": "3600" } });
    expect(m.mediaAsset.create).not.toHaveBeenCalled();
    const q = m.mediaAsset.count.mock.calls[0]![0].where;
    expect(q.status).toBeUndefined(); // counts every status
    expect(q.ownerId).toBe("u1");
  });
});
