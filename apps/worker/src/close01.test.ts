/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import { createModerationProvider, MemorySignalStore } from "@rp/core";
import { FakeClock } from "@rp/core/testing";
import { sweepVoteAnomalies } from "./trust/jobs";
import { handleNotificationRequested } from "./notifications";
import { prismaAssessPort } from "./moderation/prisma-store";

/** CLOSE-01 (task #83): production wiring for SEC-M6-02, SEC-M7-01 and QA-M7-02. */
describe("SEC-M6-02 provider selection", () => {
  it("refuses mock and unset in production; allows mock outside it", () => {
    expect(() => createModerationProvider({ NODE_ENV: "production" })).toThrow(/production/);
    expect(() => createModerationProvider({ NODE_ENV: "production", MODERATION_PROVIDER: "mock" })).toThrow(/production/);
    expect(createModerationProvider({ NODE_ENV: "development" }).name).toBe("mock");
    expect(createModerationProvider({}).name).toBe("mock");
  });
});

describe("SEC-M7-01 vote-anomaly freeze sets votesFrozenAt", () => {
  it("freezes a review whose votes exceed the hourly limit, marks votes frozen, recounts", async () => {
    const clock = new FakeClock();
    const votes = Array.from({ length: 25 }, (_, i) => ({ reviewId: "r1", createdAt: new Date(clock.now().getTime() - i * 1000), ipHash: null, user: { trustBand: "HIGH" } }));
    const calls: string[] = [];
    const tx = {
      review: { updateMany: vi.fn(async () => (calls.push("freeze"), { count: 1 })), update: vi.fn(async () => calls.push("recount")) },
      reviewVote: { updateMany: vi.fn(async () => calls.push("votes.frozen")), count: vi.fn(async () => 0) },
      auditLog: { create: vi.fn(async () => calls.push("audit")) },
    };
    const db = { reviewVote: { findMany: vi.fn(async (a: any) => (a.distinct ? [{ reviewId: "r1" }] : votes)) }, $transaction: async (fn: any) => fn(tx) };
    expect(await sweepVoteAnomalies(db, clock)).toBe(1);
    expect((tx.review.updateMany.mock.calls as any)[0][0].data.votesFrozenAt).toEqual(clock.now());
    expect(calls).toEqual(["freeze", "votes.frozen", "recount", "audit"]);
  });
  it("does not freeze a calm review", async () => {
    const clock = new FakeClock();
    const db = { reviewVote: { findMany: vi.fn(async (a: any) => (a.distinct ? [{ reviewId: "r1" }] : [{ createdAt: clock.now(), ipHash: null, user: { trustBand: "HIGH" } }])) }, $transaction: vi.fn() };
    expect(await sweepVoteAnomalies(db, clock)).toBe(0);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("SEC-M7-01 notification dispatcher is fed from outbox events", () => {
  const mk = (author: string | null) => {
    const rows: any[] = [];
    const db = { review: { findUnique: async () => (author ? { authorId: author } : null) } };
    const ports = { disabled: async () => new Set<never>(), insertInApp: async (r: any) => (rows.push(r), true), enqueueEmail: vi.fn(async () => undefined) };
    return { db, ports, rows };
  };
  it("delivers a mandatory CONTENT_REJECTED to the review author, in-app and email", async () => {
    const { db, ports, rows } = mk("author1");
    expect(await handleNotificationRequested(db, ports, new FakeClock(), "evt1", { targetType: "REVIEW", targetId: "r1", type: "CONTENT_REJECTED" })).toBe("DELIVERED");
    expect(rows[0]).toMatchObject({ recipientId: "author1", type: "CONTENT_REJECTED" });
    expect(ports.enqueueEmail).toHaveBeenCalledOnce();
  });
  it("skips unknown types, REPORT_RESOLVED (recipient not derivable) and missing targets", async () => {
    const { db, ports } = mk("a");
    expect(await handleNotificationRequested(db, ports, new FakeClock(), "e", { targetType: "REVIEW", targetId: "r1", type: "NOPE" })).toBe("SKIPPED");
    expect(await handleNotificationRequested(db, ports, new FakeClock(), "e", { targetType: "REVIEW", targetId: "r1", type: "REPORT_RESOLVED" })).toBe("SKIPPED");
    expect(await handleNotificationRequested(mk(null).db, ports, new FakeClock(), "e", { targetType: "REVIEW", targetId: "r1", type: "CONTENT_HELD" })).toBe("SKIPPED");
  });
});

describe("M7 routing feeds the assess port", () => {
  it("a product burst becomes extraForceUnsure for a PENDING review", async () => {
    const clock = new FakeClock();
    const now = clock.now();
    const db: any = {
      moderationCase: { findUnique: async () => ({ id: "c1", version: 1, createdAt: now, status: "OPEN", lane: null, trigger: "SUBMISSION", reviewId: "r1", rescanCount: 0 }), count: async () => 0 },
      moderationDecision: { findMany: async () => [], count: async () => 0 },
      review: { findUnique: async () => ({ id: "r1", status: "PENDING", currentVersion: 1, title: "t", body: "b", rating: 5, productId: "p1", authorId: "a1", author: { trustBand: "NEW" }, media: [] }), count: async () => 1 },
    };
    const burst = { recentReviews: async () => Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, createdAt: new Date(now.getTime() - i * 1000), authorBand: "NEW" as const })), openBurst: async () => null, saveBurst: async () => ({ id: "b1", opened: true }) };
    const s = await prismaAssessPort(db, clock, { burst }).load("c1");
    expect(s?.extraForceUnsure).toContain("PRODUCT_BURST");
  });
});

describe("QA-M7-02 media worker emits MALWARE_UPLOAD", () => {
  it("records the signal once per asset and requests a recompute", async () => {
    const { processMedia } = await import("./media");
    const store = new MemorySignalStore();
    const recompute = vi.fn(async () => undefined);
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
    const row = { id: "m1", status: "PROCESSING", declaredMime: "image/jpeg", ingestKey: "k", sizeBytes: bytes.length, ownerId: "uploader1" };
    const d: any = {
      db: { mediaAsset: { findUnique: async () => row, updateMany: async () => ({ count: 1 }) } },
      store: { get: async () => bytes, put: async () => undefined, delete: async () => undefined },
      buckets: { ingest: "i", private: "p" },
      scanner: { version: async () => ({ engine: "x", signatureVersion: "1", signatureDate: new Date() }), scan: async () => ({ clean: false, threat: "Eicar" }) },
      verifier: { verify: async () => [] }, signals: { store, recompute },
    };
    expect(await processMedia(d, "m1")).toBe("FAILED");
    expect(await processMedia(d, "m1")).toBe("FAILED");
    expect(store.rows.filter((r) => r.type === "MALWARE_UPLOAD" && r.subjectKey === "U:uploader1")).toHaveLength(1);
    expect(recompute).toHaveBeenCalledWith("U:uploader1");
  });
});

describe("DEF-LIVE-06 NEW_FOLLOWER resolves a USER recipient", () => {
  const mk = (user: { id: string } | null) => {
    const rows: any[] = [];
    const db = { user: { findFirst: vi.fn(async () => user) }, review: { findUnique: vi.fn() } };
    const ports = { disabled: async () => new Set<never>(), insertInApp: async (r: any) => (rows.push(r), true), enqueueEmail: vi.fn(async () => undefined) };
    return { db, ports, rows };
  };
  it("delivers an in-app notification to the followed user with the follower as actor", async () => {
    const { db, ports, rows } = mk({ id: "u2" });
    expect(await handleNotificationRequested(db, ports, new FakeClock(), "e1", { targetType: "USER", targetId: "u2", type: "NEW_FOLLOWER", actorId: "u1" })).toBe("DELIVERED");
    expect(rows[0]).toMatchObject({ recipientId: "u2", type: "NEW_FOLLOWER", actorId: "u1", entityType: "User", entityId: "u2" });
    expect(db.review.findUnique).not.toHaveBeenCalled();
  });
  it("skips when the followed user is gone or inactive, and when the in-app channel is disabled nothing is inserted", async () => {
    expect(await handleNotificationRequested(mk(null).db, mk(null).ports, new FakeClock(), "e", { targetType: "USER", targetId: "u2", type: "NEW_FOLLOWER" })).toBe("SKIPPED");
    const { db, ports, rows } = mk({ id: "u2" });
    await handleNotificationRequested(db, { ...ports, disabled: async () => new Set(["IN_APP", "EMAIL"] as any) }, new FakeClock(), "e2", { targetType: "USER", targetId: "u2", type: "NEW_FOLLOWER", actorId: "u1" });
    expect(rows).toHaveLength(0);
  });
});
