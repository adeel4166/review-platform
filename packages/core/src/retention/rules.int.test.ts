import { describe, expect, it } from "vitest";
import { FakeClock } from "../testing";
import { RETENTION_RULES, cutoffFor, runRetention, type RuleHandlers } from "./rules";
import { loadRetentionConfig, retentionConfigSchema } from "./config";
import { memoryDb } from "./test-db";

const cfg = retentionConfigSchema.parse({});
const BOUNDARY = new Date("2027-03-01T00:00:00.000Z");
const models = [...new Set(RETENTION_RULES.flatMap((r) => r.steps.map((s) => s.model)))];

describe("OPS-006: every retention rule acts only after its boundary (FakeClock +/- 1 s)", () => {
  for (const rule of RETENTION_RULES) {
    it(rule.id, async () => {
      for (const [offsetMs, expectDue] of [[-1000, false], [1000, true]] as const) {
        const { db, t } = memoryDb(models);
        const handled: string[] = [];
        const handlers: RuleHandlers = Object.fromEntries(RETENTION_RULES.map((r) => [r.id, async (ids: string[]) => { handled.push(...ids); return ids.length; }]));
        for (const [i, step] of rule.steps.entries()) {
          const rowTime = new Date(BOUNDARY.getTime() - step.ageDays(cfg) * 86_400_000); // exactly at the boundary for `now = BOUNDARY`
          t[step.model]!.push({ id: `r${i}`, [step.field]: rowTime, ...(step.where ?? {}), ...Object.fromEntries(Object.entries(step.where ?? {}).map(([k, v]) => [k, typeof v === "object" && v && "in" in v ? (v as { in: unknown[] }).in[0] : typeof v === "object" && v && "not" in v ? (v as { not: unknown }).not === null ? "x" : "y" : v])), ...(step.legalHold ? { legalHold: false } : {}) });
        }
        const clock = new FakeClock(new Date(BOUNDARY.getTime() + offsetMs));
        const res = await runRetention(db, clock, cfg, handlers, { rules: [rule] });
        expect(res[0]!.affected > 0 || handled.length > 0, `${rule.id} at ${offsetMs}`).toBe(expectDue);
      }
    });
  }
  it("covers the 16 rule ids of spec 22.1", () => expect(RETENTION_RULES.map((r) => r.id).sort()).toEqual(["RET-APPEAL-EVID", "RET-AUDIT", "RET-BREAKGLASS", "RET-CLAIM-EVID", "RET-CONTENT-DEL", "RET-IPHASH", "RET-LSH", "RET-MEDIA-REJ", "RET-NOTIF", "RET-OUTBOX", "RET-PROOF-ORIG", "RET-PROOF-RED", "RET-PROOF-TOMB", "RET-SESSIONS", "RET-SNAPSHOT", "RET-TOKENS"]));
  it("legalHold rows are never touched", async () => {
    const { db, t } = memoryDb(models);
    t.moderationCase!.push({ id: "c", resolvedAt: new Date("2020-01-01"), contentSnapshot: { a: 1 }, legalHold: true });
    await runRetention(db, new FakeClock("2027-03-01T00:00:00Z"), cfg, {}, { rules: RETENTION_RULES.filter((r) => r.id === "RET-SNAPSHOT") });
    expect(t.moderationCase![0]!.contentSnapshot).toEqual({ a: 1 });
  });
});

describe("PRV-011 RET-IPHASH", () => {
  it("nulls ipHash older than 90 days on sessions, votes and reports, keeps younger rows", async () => {
    const { db, t } = memoryDb(models);
    const now = new Date("2027-03-01T00:00:00Z");
    for (const m of ["userSession", "reviewVote", "report"]) {
      t[m]!.push({ id: "old", createdAt: new Date(now.getTime() - 91 * 86_400_000), ipHash: "a".repeat(64) }, { id: "new", createdAt: new Date(now.getTime() - 89 * 86_400_000), ipHash: "b".repeat(64) });
    }
    await runRetention(db, new FakeClock(now), cfg, {}, { rules: RETENTION_RULES.filter((r) => r.id === "RET-IPHASH") });
    for (const m of ["userSession", "reviewVote", "report"]) expect(t[m]!.map((r) => r.ipHash)).toEqual([null, "b".repeat(64)]);
  });
  it("cannot be configured beyond 90 days", () => expect(() => loadRetentionConfig({ RET_IPHASH_DAYS: "91" })).toThrow(/RET_IPHASH_DAYS/));
});

describe("SEC-M4-09 gap 2: PROOF_ORIGINAL_RETENTION is validated, not cast", () => {
  it("unknown value refuses to boot", () => expect(() => loadRetentionConfig({ PROOF_ORIGINAL_RETENTION: "NEVER" })).toThrow(/PROOF_ORIGINAL_RETENTION/));
  it("APPEAL_WINDOW moves the boundary 30 days", () => {
    const step = RETENTION_RULES.find((r) => r.id === "RET-PROOF-ORIG")!.steps[0]!;
    const now = new Date("2027-03-31T00:00:00Z");
    expect(cutoffFor(step, loadRetentionConfig({ PROOF_ORIGINAL_RETENTION: "APPEAL_WINDOW" }), now).toISOString()).toBe("2027-03-01T00:00:00.000Z");
  });
});
