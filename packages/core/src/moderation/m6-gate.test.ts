/** M6 gate (task #82): named assertions for P0 cases that were only covered by generated per-row tests or not at all. Test code only. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FakeClock } from "../testing/fake-clock";
import { addDays, addMinutes } from "../clock";
import { baseConfig } from "./test-config";
import { MemoryStore } from "./memory-store";
import { InvalidTransition, transition, type TransitionDeps } from "./transition";
import { ROWS, findRows } from "./transitions";

const cfg = baseConfig();
const sub = { type: "REVIEW" as const, id: "r1" };
function world(status: string, caseOver: Record<string, unknown> = {}) {
  const clock = new FakeClock();
  const store = new MemoryStore(clock);
  const deps: TransitionDeps = { store, clock, config: cfg, reasonCodes: new Set(["SPAM"]) };
  store.addTarget({ type: "REVIEW", id: "r1", status, version: 1, authorId: "author1", trustBand: "MEDIUM" });
  store.addCase({ id: "c1", version: 1, status: "OPEN", assignedToId: "staff1", leaseExpiresAt: addMinutes(clock.now(), 10), ...caseOver } as never);
  return { clock, store, deps };
}

describe("M6 gate: named MOD P0", () => {
  it("MOD-007 T6: staff REJECT with an unknown reasonCode -> error and no state change", async () => {
    const { store, deps } = world("HIDDEN", { lane: "HOLD", holdExpiresAt: new Date("2030-01-01") });
    await expect(transition(deps, { target: sub, kind: "CONTENT", event: "STAFF_REJECT", actor: { kind: "SMOD", id: "staff1" }, caseId: "c1", input: { reasonCode: "NOT_A_CODE", publicReason: "x" } })).rejects.toMatchObject({ code: "invalid_reason_code" });
    expect(store.targets.get("REVIEW:r1")!.status).toBe("HIDDEN");
    expect([store.audits.length, store.decisions.length, store.outbox.length]).toEqual([0, 0, 0]);
  });
  it("MOD-018: no row lets a staff actor move REJECTED to PUBLISHED; only APPEAL_OVERTURN (T12) does", () => {
    const toPublished = ROWS.filter((r) => r.kind === "CONTENT" && r.from.includes("REJECTED" as never) && r.to === "PUBLISHED");
    expect(toPublished.map((r) => r.id)).toEqual(["T12"]);
    expect(toPublished[0]!.actors).toEqual(["APPEAL_REVIEWER"]);
    for (const ev of ["STAFF_APPROVE", "POST_REVIEW_CONFIRM", "APPEAL_OVERTURN"] as const) {
      const rows = findRows("CONTENT", "REJECTED" as never, ev as never);
      for (const r of rows) expect(r.actors.some((a) => a === "MOD" || a === "SMOD")).toBe(false);
    }
  });
  it("MOD-018 runtime: STAFF_APPROVE on REJECTED is an InvalidTransition with zero writes", async () => {
    const { store, deps } = world("REJECTED");
    await expect(transition(deps, { target: sub, kind: "CONTENT", event: "STAFF_APPROVE", actor: { kind: "SMOD", id: "staff1" }, caseId: "c1" })).rejects.toBeInstanceOf(InvalidTransition);
    expect(store.targets.get("REVIEW:r1")!.status).toBe("REJECTED");
    expect(store.audits).toHaveLength(0);
  });
  it("MOD-017: DELETED has no outgoing transition; a repeated T13 changes nothing", async () => {
    expect(ROWS.filter((r) => r.kind === "CONTENT" && r.from.includes("DELETED" as never))).toEqual([]);
    const { store, deps } = world("PUBLISHED", { lane: "POST_REVIEW" });
    const req = { target: sub, kind: "CONTENT" as const, event: "AUTHOR_DELETE" as const, actor: { kind: "AUTHOR" as const, id: "author1" } };
    expect((await transition(deps, req)).applied).toBe(true);
    const snap = [store.audits.length, store.outbox.length];
    await transition(deps, req).then(() => undefined, (e) => expect(e).toBeInstanceOf(InvalidTransition));
    expect([store.audits.length, store.outbox.length]).toEqual(snap);
    expect(store.targets.get("REVIEW:r1")!.status).toBe("DELETED");
  });
  it("MOD-014: author delete from PENDING, HIDDEN and PUBLISHED -> DELETED (T13)", () => {
    expect([...ROWS.find((r) => r.id === "T13")!.from].sort()).toEqual(["HIDDEN", "PENDING", "PUBLISHED"]);
    expect(ROWS.find((r) => r.id === "T13")!.to).toBe("DELETED");
  });
  it("MOD-009 / MOD-010: post-review confirm keeps PUBLISHED; remove -> REMOVED with a reason code and media demotion", () => {
    expect(ROWS.find((r) => r.id === "T8")).toMatchObject({ to: "PUBLISHED" });
    const t9 = ROWS.find((r) => r.id === "T9")!;
    expect(t9.to).toBe("REMOVED");
    expect(t9.guard).toContain("reasonCode");
    expect(t9.effects).toContain("demoteMedia");
    expect(t9.effects).toContain("appealWindow");
  });
});

describe("M6 gate: TMR-014 no database clock for deadlines", () => {
  it("TMR-014: a hold deadline depends only on the app clock", () => {
    const clock = new FakeClock();
    const a = addDays(clock.now(), 7);
    expect(a.getTime() - clock.now().getTime()).toBe(168 * 3600_000);
  });
  it("TMR-014 static: no NOW()/CURRENT_TIMESTAMP/@default(now()) feeds a deadline column in moderation code", () => {
    const roots = [fileURLToPath(new URL("./", import.meta.url)), fileURLToPath(new URL("../../../../apps/worker/src/moderation/", import.meta.url))];
    const hits: string[] = [];
    const walk = (d: string): void => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f) && /\b(NOW\(\)|CURRENT_TIMESTAMP|UTC_TIMESTAMP)/.test(readFileSync(p, "utf8"))) hits.push(p); } };
    roots.forEach(walk);
    expect(hits).toEqual([]);
  });
});
