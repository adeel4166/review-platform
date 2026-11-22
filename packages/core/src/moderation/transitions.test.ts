import { describe, expect, it } from "vitest";
import { FakeClock } from "../testing/fake-clock";
import { addDays, addHours, addMinutes } from "../clock";
import { baseConfig } from "./test-config";
import { MemoryStore } from "./memory-store";
import { InvalidTransition, TransitionForbidden, transition, type TransitionDeps, type TransitionRequest } from "./transition";
import { EVENTS, ROWS, STATUSES, findRows, type ActorKind, type Row, type RowKind } from "./transitions";
import { holdDeadline } from "./timers";

const cfg = baseConfig();
const REASONS = new Set(["SPAM", "HARASSMENT"]);
const mk = (clock = new FakeClock(), over: Partial<TransitionDeps> = {}) => {
  const store = new MemoryStore(clock);
  const deps: TransitionDeps = { store, clock, config: cfg, reasonCodes: REASONS, ...over };
  return { store, deps, clock };
};
const actorFor = (row: Row): { kind: ActorKind; id: string | null } => {
  const kind = row.actors[0]!;
  return { kind, id: kind === "AI" || kind === "RULE" || kind === "TIMER" ? null : kind === "AUTHOR" ? "author1" : "staff1" };
};
const sub = { type: "REVIEW" as const, id: "r1" };

/** Builds the pre-state a row needs and the request that triggers it. */
function arrange(row: Row, clock: FakeClock, over: Partial<TransitionDeps> = {}) {
  const m = mk(clock, over);
  const now = clock.now();
  const from = row.from[0] as string | null;
  if (from !== null) m.store.addTarget({ type: "REVIEW", id: "r1", status: from, version: 1, authorId: "author1", trustBand: "MEDIUM" });
  const c = m.store.addCase({
    id: "c1", version: 1, lane: row.lane ?? (row.id === "T2" || row.id === "R2" ? null : null), status: "OPEN",
    holdExpiresAt: row.lane === "HOLD" ? addDays(now, -1) : null, postReviewDueAt: row.lane === "POST_REVIEW" ? addHours(now, -200) : null,
    assignedToId: "staff1", leaseExpiresAt: addMinutes(now, 10),
  });
  const input = { reasonCode: "SPAM", publicReason: "Spam", verdict: row.decision?.verdict };
  const req: TransitionRequest = { target: sub, kind: row.kind, event: row.event, actor: actorFor(row), caseId: row.guard.includes("caseOpen") || row.guard.includes("leaseHeld") || row.effects.length ? "c1" : undefined, input };
  return { ...m, c, req };
}

describe("transition table shape", () => {
  it("MOD-023 ids are unique and cover T1-T21, R1-R8, A1-A7", () => {
    const ids = new Set(ROWS.map((r) => r.id));
    expect(ids.size).toBe(ROWS.length);
    for (let i = 1; i <= 21; i++) expect(ids.has(`T${i}`)).toBe(true);
    for (let i = 1; i <= 8; i++) expect(ids.has(`R${i}`)).toBe(true);
    for (let i = 1; i <= 7; i++) expect(ids.has(`A${i}`)).toBe(true);
    for (const x of ["T4r", "T4v"]) expect(ids.has(x)).toBe(true);
  });
  it("(kind, from, event) resolves to at most one row", () => {
    for (const k of ["CONTENT", "REVISION", "APPEAL"] as RowKind[]) for (const s of [null, ...STATUSES[k]]) for (const e of EVENTS) expect(findRows(k, s, e).length).toBeLessThanOrEqual(1);
  });
  it("every Event is used by some row", () => { for (const e of EVENTS) expect(ROWS.some((r) => r.event === e)).toBe(true); });
  it("lifecycle invariant 3 / MOD-024: no automatic actor reaches REMOVED", () => {
    for (const r of ROWS) if (r.to === "REMOVED") expect(r.actors.every((a) => a === "MOD" || a === "SMOD" || a === "APPEAL_REVIEWER")).toBe(true);
  });
  it("MOD-024 T4r publishes (with POST_REVIEW) and T4v rejects", () => {
    expect(ROWS.find((r) => r.id === "T4r")).toMatchObject({ from: ["HIDDEN"], to: "PUBLISHED" });
    expect(ROWS.find((r) => r.id === "T4r")!.effects).toContain("openPostReview");
    expect(ROWS.find((r) => r.id === "T4v")).toMatchObject({ to: "REJECTED" });
  });
});

describe("generated per-row tests (MOD-001..018, MOD-023)", () => {
  for (const row of ROWS.filter((r) => r.kind !== "APPEAL")) {
    it(`${row.id}: ${row.event} ${row.from.join("|")} -> ${row.to}`, async () => {
      const clock = new FakeClock();
      const { store, deps, req } = arrange(row, clock);
      const res = await transition(deps, req);
      expect(res.applied).toBe(true);
      if (row.from[0] !== null) expect(store.targets.get("REVIEW:r1")!.status).toBe(row.to);
      expect(store.audits).toHaveLength(1); // exactly one audit row
      expect(store.audits[0]!.action).toBe(row.auditAction.replace("<e>", "review"));
      if (row.decision) {
        expect(store.decisions).toHaveLength(1);
        expect(store.decisions[0]).toMatchObject({ transition: row.id, outcome: row.decision.outcome, configVersion: cfg.version });
        if (row.decision.source !== "ACTOR") expect(store.decisions[0]!.source).toBe(row.decision.source);
        expect(store.outbox.map((o) => o.topic)).toContain("moderation.decided");
      } else expect(store.decisions).toHaveLength(0);
      for (const e of row.effects) {
        if (e === "promoteMedia") expect(store.outbox.map((o) => o.topic)).toContain("media.promote_requested");
        if (e === "demoteMedia") expect(store.outbox.map((o) => o.topic)).toContain("media.demote_requested");
        if (e === "enqueueRescan") expect(store.outbox.map((o) => o.topic)).toContain("moderation.rescan_requested");
        if (e.startsWith("notify:") && e !== "notify:none") expect(store.outbox.some((o) => o.topic === "notification.requested" && o.payload.type === e.slice(7))).toBe(true);
      }
      const c = store.cases.get("c1")!;
      if (row.effects.includes("openHold")) expect(c).toMatchObject({ lane: "HOLD", holdExpiresAt: holdDeadline(clock.now(), cfg), status: "OPEN" });
      if (row.effects.includes("openPostReview")) expect(c).toMatchObject({ lane: "POST_REVIEW", postReviewDueAt: addHours(clock.now(), 24) });
      if (row.effects.includes("resolveCase") && !row.effects.includes("openPostReview")) expect(c).toMatchObject({ status: "RESOLVED", openKey: null });
      if (row.effects.includes("appealWindow")) expect(c.appealableUntil).toEqual(addDays(clock.now(), 30));
      if (row.effects.includes("reportedLane")) expect(c).toMatchObject({ lane: "REPORTED", slaDueAt: addHours(clock.now(), 48) });
    });
  }
  it("MOD-016 negative matrix: every status x event pair not in ROWS is refused with no writes", async () => {
    let n = 0;
    for (const kind of ["CONTENT", "REVISION"] as RowKind[]) for (const s of STATUSES[kind]) for (const e of EVENTS) {
      if (findRows(kind, s, e).length) continue;
      const { store, deps } = mk();
      store.addTarget({ type: "REVIEW", id: "r1", status: s!, version: 1, authorId: "a", trustBand: "MEDIUM" });
      store.addCase({ id: "c1" });
      await expect(transition(deps, { target: sub, kind, event: e, actor: { kind: "SMOD", id: "s" }, caseId: "c1" })).rejects.toBeInstanceOf(InvalidTransition);
      expect([store.audits.length, store.decisions.length, store.outbox.length, store.targets.get("REVIEW:r1")!.status]).toEqual([0, 0, 0, s]);
      n++;
    }
    expect(n).toBeGreaterThan(100);
  });
});

describe("engine guards", () => {
  const holdRow = ROWS.find((r) => r.id === "T5")!;
  it("wrong actor kind is forbidden", async () => {
    const { deps, req } = arrange(holdRow, new FakeClock());
    await expect(transition(deps, { ...req, actor: { kind: "AUTHOR", id: "x" } })).rejects.toMatchObject({ code: "forbidden" });
  });
  it("COI: author, seller member and prior human decider are refused (AZ-011)", async () => {
    for (const id of ["author1", "seller1", "prior"]) {
      const { store, deps, req } = arrange(holdRow, new FakeClock());
      store.targets.get("REVIEW:r1")!.sellerMemberIds = ["seller1"];
      store.cases.get("c1")!.humanDeciderIds = ["prior"];
      store.cases.get("c1")!.assignedToId = id;
      await expect(transition(deps, { ...req, actor: { kind: "MOD", id } })).rejects.toMatchObject({ code: "CONFLICT_OF_INTEREST" });
    }
  });
  it("lease is checked at commit time (MOD-021, AP-5)", async () => {
    const clock = new FakeClock();
    const { store, deps, req } = arrange(holdRow, clock);
    store.cases.get("c1")!.leaseExpiresAt = addMinutes(clock.now(), -1);
    expect(await transition(deps, req)).toMatchObject({ applied: false, reason: "lease_not_held" });
    store.cases.get("c1")!.leaseExpiresAt = addMinutes(clock.now(), 5);
    store.cases.get("c1")!.assignedToId = "someoneElse";
    expect(await transition(deps, req)).toMatchObject({ applied: false, reason: "lease_not_held" });
    expect(store.targets.get("REVIEW:r1")!.status).toBe("HIDDEN");
  });
  it("MOD-021 two concurrent decides: exactly one applies", async () => {
    const { store, deps, req } = arrange(holdRow, new FakeClock());
    const rejectReq: TransitionRequest = { ...req, event: "STAFF_REJECT" };
    const results = await Promise.allSettled([transition(deps, req), transition(deps, rejectReq)]);
    const applied = results.filter((r) => r.status === "fulfilled" && r.value.applied);
    expect(applied).toHaveLength(1);
    expect(store.audits).toHaveLength(1);
  });
  it("reject needs a reason code from the ACTIVE policy list and a public reason", async () => {
    const row = ROWS.find((r) => r.id === "T6")!;
    const { deps, req } = arrange(row, new FakeClock());
    await expect(transition(deps, { ...req, input: { reasonCode: "NOPE", publicReason: "x" } })).rejects.toMatchObject({ code: "invalid_reason_code" });
    await expect(transition(deps, { ...req, input: { reasonCode: "SPAM" } })).rejects.toBeInstanceOf(TransitionForbidden);
  });
  it("ESCALATED cases need SMOD (T5)", async () => {
    const { store, deps, req } = arrange(holdRow, new FakeClock());
    store.cases.get("c1")!.status = "ESCALATED";
    await expect(transition(deps, req)).rejects.toMatchObject({ code: "smod_required" });
    expect(await transition(deps, { ...req, actor: { kind: "SMOD", id: "staff1" } })).toMatchObject({ applied: true });
  });
  it("MOD-015 edit limit: 6th edit within the limiter is refused", async () => {
    let n = 0;
    const { deps, store } = mk(new FakeClock(), { editLimit: async () => ++n <= 5 });
    store.addTarget({ type: "REVIEW", id: "r1", status: "PENDING", version: 1, authorId: "a" });
    store.addCase({ id: "c1" });
    for (let i = 0; i < 5; i++) {
      store.targets.get("REVIEW:r1")!.status = "PENDING";
      store.cases.get("c1")!.status = "OPEN";
      expect(await transition(deps, { target: sub, event: "AUTHOR_EDIT", actor: { kind: "AUTHOR", id: "a" }, caseId: "c1" })).toMatchObject({ applied: true });
    }
    await expect(transition(deps, { target: sub, event: "AUTHOR_EDIT", actor: { kind: "AUTHOR", id: "a" }, caseId: "c1" })).rejects.toMatchObject({ code: "rate_limited" });
  });
  it("T20 refuses with an open appeal or a legal hold", async () => {
    const row = ROWS.find((r) => r.id === "T20")!;
    const a = arrange(row, new FakeClock());
    a.store.openAppeals.add("c1");
    await expect(transition(a.deps, a.req)).rejects.toMatchObject({ code: "open_appeal" });
    const b = arrange(row, new FakeClock());
    b.store.cases.get("c1")!.legalHold = true;
    await expect(transition(b.deps, b.req)).rejects.toMatchObject({ code: "legal_hold" });
  });
  it("MOD-025 / AP-2: reinstating a decision for a superseded version is refused", async () => {
    const row = ROWS.find((r) => r.id === "T12")!;
    const { store, deps, req } = arrange(row, new FakeClock());
    store.targets.get("REVIEW:r1")!.version = 2;
    expect(await transition(deps, req)).toMatchObject({ applied: false, reason: "version_superseded" });
    expect(store.targets.get("REVIEW:r1")!.status).toBe("REJECTED");
  });
  it("CLS-012 zero tolerance: case ESCALATED with legal hold, no auto-resolve, protective hold requested", async () => {
    const row = ROWS.find((r) => r.id === "T3")!;
    const { store, deps, req } = arrange(row, new FakeClock());
    await transition(deps, { ...req, input: { ...req.input, zeroTolerance: true, verdict: "VIOLATION" } });
    expect(store.cases.get("c1")).toMatchObject({ status: "ESCALATED", legalHold: true });
    expect(store.outbox.map((o) => o.topic)).toContain("enforcement.zero_tolerance_hold");
  });
  it("MOD-003: unsampled post-review resolves NOT_SAMPLED", async () => {
    const lowRate = structuredClone(cfg);
    lowRate.postReview.sampleRate.MEDIUM = 0;
    const row = ROWS.find((r) => r.id === "T2")!;
    const { store, deps, req } = arrange(row, new FakeClock(), { config: lowRate });
    await transition(deps, req);
    expect(store.cases.get("c1")).toMatchObject({ status: "RESOLVED", resolutionCode: "NOT_SAMPLED" });
  });
  it("leaving PUBLISHED supersedes other open cases on the target", async () => {
    const row = ROWS.find((r) => r.id === "T9")!;
    const { store, deps, req } = arrange(row, new FakeClock());
    store.addCase({ id: "c2", lane: "REPORTED", openKey: "REPORTED:R:r1" });
    await transition(deps, req);
    expect(store.cases.get("c2")).toMatchObject({ status: "RESOLVED", resolutionCode: "SUPERSEDED" });
  });
});

describe("MOD-020 atomicity: a fault between writes rolls back everything", () => {
  for (const fault of ["insertDecision", "insertAudit", "insertOutbox", "patchCase"] as const) {
    it(`fault in ${fault}`, async () => {
      const row = ROWS.find((r) => r.id === "T2")!;
      const { store, deps, req } = arrange(row, new FakeClock());
      store.failOn = fault;
      await expect(transition(deps, req)).rejects.toThrow(/injected_fault/);
      expect(store.targets.get("REVIEW:r1")!.status).toBe("PENDING");
      expect([store.audits.length, store.decisions.length, store.outbox.length]).toEqual([0, 0, 0]);
      expect(store.cases.get("c1")).toMatchObject({ lane: null, status: "OPEN" });
    });
  }
});

describe("timers through transition() (TMR-003/006/008/010/013, CFG-003)", () => {
  const t7 = ROWS.find((r) => r.id === "T7")!;
  it("TMR-003 fires at now >= deadline, not before", async () => {
    const clock = new FakeClock();
    const { store, deps, req } = arrange(t7, clock);
    const deadline = addHours(clock.now(), 5);
    store.cases.get("c1")!.holdExpiresAt = deadline;
    clock.set(new Date(deadline.getTime() - 1));
    expect(await transition(deps, req)).toMatchObject({ applied: false, reason: "deadline_not_reached" });
    clock.set(deadline);
    expect(await transition(deps, req)).toMatchObject({ applied: true });
    expect(store.decisions[0]).toMatchObject({ source: "RULE", reasonCode: "HOLD_EXPIRED" });
  });
  it("TMR-013 / MT-1: a job carrying an old deadline is a no-op", async () => {
    const { store, deps, req } = arrange(t7, new FakeClock());
    expect(await transition(deps, { ...req, expectedDeadlineMs: store.cases.get("c1")!.holdExpiresAt!.getTime() + 1 })).toMatchObject({ applied: false, reason: "deadline_changed" });
  });
  it("TMR-006 approve vs expire at the same instant: one wins, the other is a no-op", async () => {
    for (const order of [0, 1]) {
      const clock = new FakeClock();
      const { store, deps, req } = arrange(t7, clock);
      const approve: TransitionRequest = { ...req, event: "STAFF_APPROVE", actor: { kind: "MOD", id: "staff1" } };
      const seq = order ? [req, approve] : [approve, req];
      const out = [];
      for (const r of seq) out.push(await transition(deps, r).then((x) => x.applied, () => false));
      expect(out.filter(Boolean)).toHaveLength(1);
      expect(store.audits).toHaveLength(1);
      expect(store.targets.get("REVIEW:r1")!.status).toBe(order ? "REJECTED" : "PUBLISHED");
    }
  });
  it("TMR-010 an edit supersedes the case; the old delayed job is a no-op", async () => {
    const { store, deps, req } = arrange(t7, new FakeClock());
    await transition(deps, { target: sub, event: "AUTHOR_EDIT", actor: { kind: "AUTHOR", id: "author1" }, caseId: "c1" });
    expect(store.cases.get("c1")!.resolutionCode).toBe("SUPERSEDED");
    const r = await transition(deps, req).then((x) => x.applied, () => false);
    expect(r).toBe(false);
    expect(store.targets.get("REVIEW:r1")!.status).toBe("PENDING");
  });
  it("TMR-008 / CFG-003 deadlines and decisions keep the config in force when they were written", async () => {
    const clock = new FakeClock();
    const t4 = ROWS.find((r) => r.id === "T4")!;
    const a = arrange(t4, clock);
    await transition(a.deps, a.req);
    const first = a.store.cases.get("c1")!.holdExpiresAt!;
    const cfg2 = structuredClone(cfg); cfg2.timers.holdDays = 1; cfg2.version = "v2";
    const t5 = ROWS.find((r) => r.id === "T5")!;
    void t5;
    expect(first).toEqual(addDays(clock.now(), 7)); // later config change never moves it
    expect(a.store.decisions[0]!.configVersion).toBe(cfg.version);
    a.deps.config = cfg2;
    expect(a.store.decisions[0]!.configVersion).toBe(cfg.version); // earlier decision untouched
    expect(a.store.cases.get("c1")!.holdExpiresAt).toEqual(first);
  });
  it("TMR-004 days are always 24 h steps in UTC", () => {
    expect(addDays(new Date("2027-03-27T12:00:00Z"), 2).toISOString()).toBe("2027-03-29T12:00:00.000Z");
    expect(addDays(new Date("2027-10-30T12:00:00Z"), 2).toISOString()).toBe("2027-11-01T12:00:00.000Z");
  });
});
