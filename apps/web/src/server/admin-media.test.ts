import { describe, expect, it, vi } from "vitest";
import { FakeObjectStore } from "@rp/core";
import { decideMedia, listMediaQueue } from "./admin-media";
import type { Db } from "./db";
import type { Actor } from "./session";
import type { Storage } from "./media";

const admin: Actor = { id: "a1", role: "admin" };
const user: Actor = { id: "u1", role: "user" } as Actor;

function setup(asset: unknown, handled = 0) {
  const tx = {
    mediaAsset: { findUnique: vi.fn().mockResolvedValue(asset), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    mediaProcessingLog: { count: vi.fn().mockResolvedValue(handled), create: vi.fn() },
    outboxEvent: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const db = { ...tx, $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as Db;
  const store = new FakeObjectStore();
  const st: Storage = { store, buckets: { ingest: "ingest", private: "private" } };
  return { db, tx, store, st };
}

describe("admin media queue", () => {
  it("is staff-only (server-side) for list and decide", async () => {
    const s = setup({ id: "m1", status: "FAILED", failureReason: "MALWARE", reviewId: "r1" });
    await expect(listMediaQueue(s.db, user, 1, 20)).rejects.toMatchObject({ status: 403 });
    await expect(decideMedia(s.db, s.st, user, "m1", "reject")).rejects.toMatchObject({ status: 403 });
    expect(s.tx.mediaAsset.findUnique).not.toHaveBeenCalled();
  });
  it("lists metadata only and flags which items are retryable", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "m1", reviewId: "r", kind: "IMAGE", failureReason: "MALWARE", createdAt: new Date(), processedAt: null },
      { id: "m2", reviewId: "r", kind: "VIDEO", failureReason: "SCAN_UNAVAILABLE", createdAt: new Date(), processedAt: null },
    ]);
    const db = { mediaAsset: { findMany, count: vi.fn().mockResolvedValue(2) } } as unknown as Db;
    const r = await listMediaQueue(db, admin, 1, 20);
    expect(r.items.map((i) => i.retryable)).toEqual([false, true]);
    const args = findMany.mock.calls[0]![0] as { select: Record<string, boolean>; where: { status: string } };
    expect(args.where.status).toBe("FAILED");
    expect(Object.keys(args.select)).not.toContain("ingestKey");
    expect(Object.keys(args.select)).not.toContain("thumbKey");
  });
  it("reject closes the case, audits and deletes the quarantined copy", async () => {
    const s = setup({ id: "m1", status: "FAILED", failureReason: "MALWARE", reviewId: "r1" });
    await s.store.put("private", "quarantine/m1", Buffer.from("x"), "application/octet-stream");
    await decideMedia(s.db, s.st, admin, "m1", "reject");
    expect(s.tx.auditLog.create.mock.calls[0]![0].data).toMatchObject({ action: "media.rejected", actorId: "a1" });
    expect(await s.store.head("private", "quarantine/m1")).toBeNull();
  });
  it("approve re-queues only retryable failures, never malware", async () => {
    const bad = setup({ id: "m1", status: "FAILED", failureReason: "MALWARE", reviewId: "r1" });
    await expect(decideMedia(bad.db, bad.st, admin, "m1", "approve")).rejects.toMatchObject({ status: 409, code: "not_retryable" });
    expect(bad.tx.outboxEvent.create).not.toHaveBeenCalled();
    const ok = setup({ id: "m2", status: "FAILED", failureReason: "SCAN_UNAVAILABLE", reviewId: "r1" });
    await decideMedia(ok.db, ok.st, admin, "m2", "approve");
    expect(ok.tx.outboxEvent.create.mock.calls[0]![0].data.type).toBe("media.uploaded");
  });
  it("409s when already handled or not failed", async () => {
    const a = setup({ id: "m1", status: "FAILED", failureReason: "MALWARE", reviewId: "r" }, 1);
    await expect(decideMedia(a.db, a.st, admin, "m1", "reject")).rejects.toMatchObject({ status: 409 });
    const b = setup({ id: "m1", status: "READY", failureReason: null, reviewId: "r" });
    await expect(decideMedia(b.db, b.st, admin, "m1", "reject")).rejects.toMatchObject({ status: 409 });
  });
});
