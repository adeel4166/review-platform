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
  const st: Storage = { store, buckets: { ingest: "ingest", private: "private" } };
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
  it("404s for someone else's review and 409s at 5 images", async () => {
    const a = setup({ review: null });
    await expect(createUploadSlot(a.db, a.st, "u2", "r1", input)).rejects.toMatchObject({ status: 404 });
    const b = setup({ count: 5 });
    await expect(createUploadSlot(b.db, b.st, "u1", "r1", input)).rejects.toMatchObject({ status: 409, code: "media_limit" });
    expect(b.m.mediaAsset.create).not.toHaveBeenCalled();
  });
});

describe("media on non-PENDING reviews (SEC-02)", () => {
  it.each(["PUBLISHED", "REJECTED", "HIDDEN"])("409s a slot on a %s review", async (status) => {
    const { db, st, m } = setup({ review: { id: "r1", status } });
    await expect(createUploadSlot(db, st, "u1", "r1", input)).rejects.toMatchObject({ status: 409 });
    expect(m.mediaAsset.create).not.toHaveBeenCalled();
  });
  it.each(["PUBLISHED", "REJECTED", "HIDDEN"])("409s confirm when the review is %s", async (status) => {
    const { db, st, tx } = setup({ asset: { id: "m1", status: "UPLOADING", sizeBytes: 1000, ingestKey: "in/m1", review: { status } } });
    await expect(confirmUpload(db, st, "u1", "m1")).rejects.toMatchObject({ status: 409 });
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
  it("hides READY assets created after the review was published", async () => {
    const { db, st, m } = setup();
    const pub = new Date("2026-01-02");
    const row = (id: string, createdAt: Date) => ({ id, reviewId: "r1", createdAt, width: 1, height: 1, thumbKey: "t", mediumKey: "md", review: { publishedAt: pub } });
    m.mediaAsset.findMany.mockResolvedValue([row("old", new Date("2026-01-01")), row("late", new Date("2026-01-03"))]);
    const out = await readyMediaUrls(db, st, ["r1"]);
    expect(out.get("r1")?.map((i) => i.id)).toEqual(["old"]);
  });
});

describe("confirmUpload", () => {
  it("moves to PROCESSING and enqueues via the outbox when the object matches", async () => {
    const { db, st, store, tx } = setup();
    store.objects.set("ingest/in/m1", Buffer.alloc(1000));
    await confirmUpload(db, st, "u1", "m1");
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "media.uploaded", payload: { assetId: "m1" } }) });
  });
  it("fails a missing or wrong-size upload and deletes the object", async () => {
    const a = setup();
    await expect(confirmUpload(a.db, a.st, "u1", "m1")).rejects.toMatchObject({ status: 422 });
    expect(a.m.mediaAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "FAILED", failureReason: "MISSING_OBJECT" } }));
    const b = setup();
    b.store.objects.set("ingest/in/m1", Buffer.alloc(2000));
    await expect(confirmUpload(b.db, b.st, "u1", "m1")).rejects.toMatchObject({ status: 422 });
    expect(b.store.objects.size).toBe(0);
  });
  it("404s for another user's asset", async () => {
    const { db, st } = setup({ asset: null });
    await expect(confirmUpload(db, st, "u2", "m1")).rejects.toMatchObject({ status: 404 });
  });
});

describe("readyMediaUrls", () => {
  it("queries only READY media of PUBLISHED reviews", async () => {
    const { db, st, m } = setup();
    m.mediaAsset.findMany.mockResolvedValue([{ id: "m1", reviewId: "r1", width: 10, height: 10, thumbKey: "t", mediumKey: "md", createdAt: new Date("2026-01-01"), review: { publishedAt: new Date("2026-01-02") } }]);
    const out = await readyMediaUrls(db, st, ["r1"]);
    expect((m.mediaAsset.findMany.mock.calls[0]?.[0] as { where: unknown }).where).toMatchObject({ status: "READY", review: { status: "PUBLISHED" } });
    expect(out.get("r1")?.[0]?.thumbUrl).toContain("private/t");
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
