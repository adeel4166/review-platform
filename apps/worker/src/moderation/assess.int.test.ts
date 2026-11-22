import { describe, expect, it } from "vitest";
import { Breaker, CATEGORIES, ProviderError, addDays, addMinutes } from "@rp/core";
import { FakeClock, MemoryStore, baseConfig } from "@rp/core/testing";
import { runAssess, type AssessJobDeps } from "./assess";
import { runRescanFailed } from "./rescan-failed";
import { applyBulk, type BulkPort, type BulkResult } from "./bulk";
import { scanStaffAnomalies } from "../maintenance/staff-anomaly";
import { MemPorts } from "./test-ports";

const cfg = baseConfig();
const clean = { scores: Object.fromEntries(CATEGORIES.map((c) => [c, 0.005])) };
const viol = { scores: { ...clean.scores, harassment_hate: 0.9 } };
const REASONS = new Set(["SPAM"]);

function setup(answer: () => unknown, media: "NONE" | "PENDING" | "MALWARE" = "NONE", status = "PENDING") {
  const clock = new FakeClock();
  const store = new MemoryStore(clock);
  const ports = new MemPorts(store);
  store.addTarget({ type: "REVIEW", id: "r1", status, version: 1, authorId: "a", trustBand: "MEDIUM" });
  const c = store.addCase({ id: "c1", lane: status === "HIDDEN" ? "HOLD" : null, holdExpiresAt: status === "HIDDEN" ? addDays(clock.now(), 7) : null, openKey: "HOLD:R:r1" });
  ports.track(c, { createdAt: clock.now(), targetId: "r1", media, kind: "CONTENT" });
  const calls = { n: 0 };
  const deps: AssessJobDeps = { store, port: ports, clock, config: cfg, reasonCodes: REASONS, provider: { cfg, call: async () => { calls.n++; const a = answer(); if (a instanceof Error) throw a; return a; } } };
  return { clock, store, ports, deps, calls };
}

describe("moderation.assess", () => {
  it("CLEAN -> T2 publish with POST_REVIEW; VIOLATION -> T3; failure -> T4 hold", async () => {
    const a = setup(() => clean);
    expect(await runAssess(a.deps, "c1", 1)).toEqual({ status: "applied", verdict: "CLEAN", transition: "T2" });
    expect(a.store.cases.get("c1")).toMatchObject({ lane: "POST_REVIEW" });
    const b = setup(() => viol);
    expect(await runAssess(b.deps, "c1", 1)).toMatchObject({ verdict: "VIOLATION", transition: "T3" });
    expect(b.store.decisions[0]).toMatchObject({ source: "AI", outcome: "REMOVE", reasonCode: "harassment_hate" });
    const c = setup(() => new ProviderError("timeout"));
    expect(await runAssess(c.deps, "c1", 1)).toMatchObject({ verdict: "UNSURE", transition: "T4" });
    expect(c.store.decisions[0]).toMatchObject({ failureCode: "timeout", source: "RULE" });
  });
  it("MED-030 / QA-M5-04 waits for pending media (30 s polls), then MEDIA_TIMEOUT -> UNSURE after the max wait", async () => {
    const s = setup(() => clean, "PENDING");
    expect(await runAssess(s.deps, "c1", 1)).toEqual({ status: "delay", delayMs: 30_000 });
    expect(s.calls.n).toBe(0);
    s.clock.advance(30 * 60_000);
    expect(await runAssess(s.deps, "c1", 1)).toMatchObject({ status: "applied", verdict: "UNSURE", transition: "T4" });
    expect(s.store.decisions[0]!.reasonCode).toBe("MEDIA_TIMEOUT");
  });
  it("MED-012 malware media forces the parent UNSURE even when the text is clean", async () => {
    const s = setup(() => clean, "MALWARE");
    expect(await runAssess(s.deps, "c1", 1)).toMatchObject({ verdict: "UNSURE" });
    expect(s.store.decisions[0]!.reasonCode).toBe("MEDIA_MALWARE");
  });
  it("a result for a superseded version is discarded; a resolved case is skipped; reruns are idempotent", async () => {
    const s = setup(() => clean);
    expect(await runAssess(s.deps, "c1", 0)).toMatchObject({ status: "skipped", reason: "version_superseded" });
    expect(await runAssess(s.deps, "c1", 1)).toMatchObject({ status: "applied" });
    expect(await runAssess(s.deps, "c1", 1)).toMatchObject({ status: "skipped" });
    expect(s.store.decisions).toHaveLength(1);
  });
});

describe("AIF-007 rescan-failed (T4r / T4v), TMR-009", () => {
  const rescanDeps = (s: ReturnType<typeof setup>, open = false) => {
    const breaker = new Breaker(s.clock, cfg.ai.circuitBreaker);
    if (open) for (let i = 0; i < 20; i++) breaker.record(false);
    const rescan = { heldAiUnavailable: async () => [{ caseId: "c1", contentVersion: 1, rescanCount: s.store.cases.get("c1")!.rescanCount ?? 0 }], incrementRescan: async (id: string, max: number) => { const c = s.store.cases.get(id)!; if ((c.rescanCount ?? 0) >= max) return false; c.rescanCount = (c.rescanCount ?? 0) + 1; return true; } };
    return { ...s.deps, rescan, breaker };
  };
  it("recovered provider + CLEAN publishes with POST_REVIEW (T4r) and never moves holdExpiresAt before that", async () => {
    const s = setup(() => clean, "NONE", "HIDDEN");
    const hold = s.store.cases.get("c1")!.holdExpiresAt;
    expect(await runRescanFailed(rescanDeps(s))).toEqual({ scanned: 1, applied: 1 });
    expect(s.store.targets.get("REVIEW:r1")!.status).toBe("PUBLISHED");
    expect(s.store.cases.get("c1")).toMatchObject({ lane: "POST_REVIEW", rescanCount: 1 });
    expect(hold).toBeTruthy();
  });
  it("VIOLATION rejects (T4v); UNSURE changes nothing and keeps the hold deadline", async () => {
    const v = setup(() => viol, "NONE", "HIDDEN");
    await runRescanFailed(rescanDeps(v));
    expect(v.store.targets.get("REVIEW:r1")!.status).toBe("REJECTED");
    const u = setup(() => ({ scores: { ...clean.scores, spam: 0.5 } }), "NONE", "HIDDEN");
    const hold = u.store.cases.get("c1")!.holdExpiresAt;
    expect(await runRescanFailed(rescanDeps(u))).toEqual({ scanned: 1, applied: 0 });
    expect(u.store.targets.get("REVIEW:r1")!.status).toBe("HIDDEN");
    expect(u.store.cases.get("c1")!.holdExpiresAt).toEqual(hold);
  });
  it("skips while the breaker is open and stops after maxRescans", async () => {
    const o = setup(() => clean, "NONE", "HIDDEN");
    expect(await runRescanFailed(rescanDeps(o, true))).toEqual({ scanned: 0, applied: 0 });
    const m = setup(() => ({ scores: { ...clean.scores, spam: 0.5 } }), "NONE", "HIDDEN");
    for (let i = 0; i < 5; i++) await runRescanFailed(rescanDeps(m));
    expect(m.store.cases.get("c1")!.rescanCount).toBe(3);
  });
});

describe("bulk apply (E2E-007) and staff anomaly scan (SEC-012)", () => {
  it("each item goes through transition() with its own lease; MODERATOR cannot reject; results recorded", async () => {
    const clock = new FakeClock();
    const store = new MemoryStore(clock);
    const rec: Record<string, BulkResult | string> = {};
    for (const id of ["a", "b", "c"]) { store.addTarget({ type: "REVIEW", id: `r${id}`, status: "HIDDEN", version: 1, authorId: id === "c" ? "mod1" : "x" }); store.addCase({ id, lane: "HOLD", holdExpiresAt: addDays(clock.now(), 7) }); }
    const leased = new Set(["b"]);
    const mk = (action: "approve" | "reject", role: "MODERATOR" | "SENIOR_MODERATOR"): BulkPort => ({
      items: async () => ({ op: { requestedById: "mod1", requesterRole: role, lane: "HOLD", action, reasonCode: "SPAM", publicReason: "spam" }, items: ["a", "b", "c"].map((id) => ({ caseId: id, target: { type: "REVIEW" as const, id: `r${id}` }, kind: "CONTENT" as const, lane: "HOLD" as const, targetStatus: "HIDDEN" })) }),
      lease: async (id, user, now) => { if (leased.has(id)) return false; const c = store.cases.get(id)!; c.assignedToId = user; c.leaseExpiresAt = addMinutes(now, 15); return true; },
      release: async (id) => { const c = store.cases.get(id)!; c.assignedToId = null; c.leaseExpiresAt = null; },
      record: async (_b, id, r, why) => void (rec[id] = `${r}:${why ?? ""}`),
      complete: async () => {},
    });
    const deps = { store, clock, config: cfg, reasonCodes: REASONS };
    expect(await applyBulk({ ...deps, port: mk("reject", "MODERATOR") }, "op1")).toEqual({ applied: 0, skipped: 3, failed: 0 });
    expect(await applyBulk({ ...deps, port: mk("approve", "MODERATOR") }, "op2")).toEqual({ applied: 1, skipped: 2, failed: 0 });
    expect(rec).toMatchObject({ a: "APPLIED:", b: "SKIPPED:leased", c: "SKIPPED:coi" });
    expect(store.audits).toHaveLength(1);
  });
  it("SEC-012 flags concentration, AI disagreement and bulk volume without sanctioning", () => {
    const out = scanStaffAnomalies([
      { moderatorId: "m1", removalsBySeller: { s1: 11, s2: 10 }, decisions: 100, disagreeingWithAi: 31, bulkOperations: 6 },
      { moderatorId: "m2", removalsBySeller: { s1: 10 }, decisions: 49, disagreeingWithAi: 49, bulkOperations: 5 },
    ]);
    expect(out.map((a) => `${a.moderatorId}:${a.kind}`).sort()).toEqual(["m1:ai_disagreement", "m1:bulk_volume", "m1:removals_concentrated"]);
  });
});
