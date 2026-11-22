import { describe, expect, it, vi } from "vitest";
import { FakeModerationDb, type ModerationProvider } from "@rp/core";
import { MODERATION_JOB_OPTIONS, escalateDeadLetter, isFinalFailure, processModeration, type WorkerDb } from "./moderation";

const asDb = (f: FakeModerationDb) => f as unknown as WorkerDb;
const provider = (a: { score: number; confidence: number }): ModerationProvider => ({
  name: "t", assess: vi.fn(async () => ({ ...a, reasons: ["r"] })),
});
const job = (id: string, version = 1) => ({ subjectType: "REVIEW" as const, subjectId: id, version });

describe("processModeration", () => {
  it("PENDING -> AI_REVIEW -> APPROVED publishes clean content and stores score+reasons", async () => {
    const f = new FakeModerationDb();
    const r = f.addReview();
    expect(await processModeration(asDb(f), provider({ score: 0.01, confidence: 0.95 }), job(r.id as string))).toBe("APPROVED");
    expect(r.status).toBe("PUBLISHED");
    expect(f.cases[0]).toMatchObject({ state: "APPROVED", aiScore: 0.01, aiReasons: ["r"], aiProvider: "t" });
    expect(f.audit.map((a) => a.action)).toEqual(["review.ai_review_start", "review.approve"]);
  });
  it("clear violation -> REJECTED", async () => {
    const f = new FakeModerationDb();
    const r = f.addReview();
    expect(await processModeration(asDb(f), provider({ score: 0.99, confidence: 0.95 }), job(r.id as string))).toBe("REJECTED");
    expect(r.status).toBe("REJECTED");
  });
  it("low confidence -> NEEDS_HUMAN and review hidden", async () => {
    const f = new FakeModerationDb();
    const r = f.addReview();
    expect(await processModeration(asDb(f), provider({ score: 0.01, confidence: 0.2 }), job(r.id as string))).toBe("NEEDS_HUMAN");
    expect(r.status).toBe("HIDDEN");
    expect(f.audit.at(-1)).toMatchObject({ action: "review.hold", actorType: "AI" });
  });
  it("provider failure throws (for retry), leaves the case in AI_REVIEW and does not approve; retry then succeeds", async () => {
    const f = new FakeModerationDb();
    const r = f.addReview();
    const bad: ModerationProvider = { name: "t", assess: vi.fn().mockRejectedValueOnce(new Error("503")).mockResolvedValue({ score: 0, confidence: 1, reasons: [] }) };
    await expect(processModeration(asDb(f), bad, job(r.id as string))).rejects.toThrow("503");
    expect(f.cases[0]!.state).toBe("AI_REVIEW");
    expect(r.status).toBe("PENDING");
    expect(await processModeration(asDb(f), bad, job(r.id as string))).toBe("APPROVED");
  });
  it("is idempotent for decided, stale or missing subjects", async () => {
    const f = new FakeModerationDb();
    const r = f.addReview();
    const p = provider({ score: 0, confidence: 1 });
    await processModeration(asDb(f), p, job(r.id as string));
    expect(await processModeration(asDb(f), p, job(r.id as string))).toBe("SKIPPED");
    expect(await processModeration(asDb(f), p, job("missing"))).toBe("SKIPPED");
    const r2 = f.addReview({ currentVersion: 2 });
    expect(await processModeration(asDb(f), p, job(r2.id as string, 1))).toBe("SKIPPED");
    expect(await processModeration(asDb(f), p, { subjectType: "COMMENT", subjectId: "x", version: 1 })).toBe("SKIPPED");
  });
});

describe("dead-letter", () => {
  it("escalates an exhausted job to NEEDS_HUMAN (never approves)", async () => {
    const f = new FakeModerationDb();
    const r = f.addReview();
    const c = f.addCase(r.id as string, "AI_REVIEW");
    expect(await escalateDeadLetter(asDb(f), job(r.id as string), "provider down", "j1")).toBe(true);
    expect(c.state).toBe("NEEDS_HUMAN");
    expect(r.status).toBe("HIDDEN");
    expect(f.audit.at(-1)).toMatchObject({ action: "review.hold", metadata: expect.objectContaining({ reason: "ai_failure_dead_letter" }) });
  });
  it("also escalates a case that never started, and no-ops once decided", async () => {
    const f = new FakeModerationDb();
    const r = f.addReview();
    expect(await escalateDeadLetter(asDb(f), job(r.id as string), "x")).toBe(true);
    const r2 = f.addReview();
    f.addCase(r2.id as string, "APPROVED");
    expect(await escalateDeadLetter(asDb(f), job(r2.id as string), "x")).toBe(false);
  });
  it("retry policy: exponential backoff, final failure only after last attempt", () => {
    expect(MODERATION_JOB_OPTIONS.attempts).toBeGreaterThan(1);
    expect(MODERATION_JOB_OPTIONS.backoff.type).toBe("exponential");
    expect(isFinalFailure({ attemptsMade: 4, opts: { attempts: 5 } })).toBe(false);
    expect(isFinalFailure({ attemptsMade: 5, opts: { attempts: 5 } })).toBe(true);
  });
});
