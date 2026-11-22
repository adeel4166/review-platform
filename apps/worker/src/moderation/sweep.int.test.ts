import { describe, expect, it } from "vitest";
import { addDays, addHours, addMinutes, baseConfigForTests } from "./helpers";
import { FakeClock, MemoryStore } from "@rp/core/testing";
import { runSweep } from "./sweep";
import { holdExpire, postReviewLapse, scheduleFor } from "./timers";
import { MemPorts } from "./test-ports";
import { holdExpireJobId } from "@rp/core";

const cfg = baseConfigForTests();
const REASONS = new Set(["SPAM"]);
function setup() {
  const clock = new FakeClock();
  const store = new MemoryStore(clock);
  const ports = new MemPorts(store);
  const deps = { store, port: ports, clock, config: cfg, reasonCodes: REASONS };
  const add = (o: { id: string; status: string; lane?: "HOLD" | "POST_REVIEW" | "REPORTED" | null; createdAt?: Date; hold?: Date | null; due?: Date | null; media?: "NONE" | "PENDING"; kind?: "CONTENT" | "REVISION" }) => {
    store.addTarget({ type: "REVIEW", id: `r-${o.id}`, status: o.status, version: 1, authorId: "a", trustBand: "MEDIUM" });
    const c = store.addCase({ id: o.id, lane: o.lane ?? null, holdExpiresAt: o.hold ?? null, postReviewDueAt: o.due ?? null, openKey: `${o.lane ?? "X"}:R:r-${o.id}` });
    ports.track(c, { createdAt: o.createdAt ?? clock.now(), targetId: `r-${o.id}`, media: o.media ?? "NONE", kind: o.kind ?? "CONTENT" });
    return c;
  };
  return { clock, store, ports, deps, add };
}

describe("sweeper and timers (TMR-*, AIF-006)", () => {
  it("AIF-006 lost job: PENDING case older than 10 min -> T4 UNSURE lost_job; with media, 40 min", async () => {
    const s = setup();
    s.add({ id: "c1", status: "PENDING" });
    s.add({ id: "c2", status: "PENDING", media: "PENDING" });
    s.clock.advance(10 * 60_000 - 1);
    expect((await runSweep(s.deps)).aiPending).toBe(0);
    s.clock.advance(1);
    expect((await runSweep(s.deps)).aiPending).toBe(1); // c1 only
    expect(s.store.targets.get("REVIEW:r-c1")!.status).toBe("HIDDEN");
    expect(s.store.decisions[0]).toMatchObject({ failureCode: "lost_job", source: "RULE", verdict: "UNSURE" });
    expect(s.store.cases.get("c1")).toMatchObject({ lane: "HOLD", holdExpiresAt: addDays(s.clock.now(), 7) });
    expect(s.store.targets.get("REVIEW:r-c2")!.status).toBe("PENDING");
    s.clock.advance(30 * 60_000);
    expect((await runSweep(s.deps)).aiPending).toBe(1);
    expect(s.store.targets.get("REVIEW:r-c2")!.status).toBe("HIDDEN");
  });
  it("TMR-002/003/007 hold expiry via the sweeper with a flushed queue (T7; no strike)", async () => {
    const s = setup();
    const deadline = addDays(s.clock.now(), 7);
    s.add({ id: "h1", status: "HIDDEN", lane: "HOLD", hold: deadline });
    s.clock.set(new Date(deadline.getTime() - 1));
    expect((await runSweep(s.deps)).holdExpired).toBe(0);
    s.clock.set(deadline);
    expect((await runSweep(s.deps)).holdExpired).toBe(1);
    expect(s.store.targets.get("REVIEW:r-h1")!.status).toBe("REJECTED");
    expect(s.store.decisions[0]).toMatchObject({ source: "RULE", reasonCode: "HOLD_EXPIRED", outcome: "REMOVE" });
    expect(s.store.cases.get("h1")!.appealableUntil).toEqual(addDays(deadline, 30));
    expect(s.store.outbox.some((o) => o.topic === "moderation.strike_requested")).toBe(false);
    expect((await runSweep(s.deps)).holdExpired).toBe(0); // idempotent
  });
  it("TMR-004 hold of 7 days is 168 h; TMR-005 reminder at deadline - 48 h bumps once", async () => {
    const s = setup();
    const deadline = addHours(s.clock.now(), 168);
    s.add({ id: "h1", status: "HIDDEN", lane: "HOLD", hold: deadline });
    s.clock.set(addHours(deadline, -48));
    expect((await runSweep(s.deps)).holdReminded).toBe(1);
    expect((await runSweep(s.deps)).holdReminded).toBe(0);
    expect(s.store.cases.get("h1")!.priority).toBe(1000);
  });
  it("TMR-001 post-review SLA breach counted once, no state change; TMR-002 lapse at +144 h (T10, MOD-011)", async () => {
    const s = setup();
    const due = addHours(s.clock.now(), 24);
    s.add({ id: "p1", status: "PUBLISHED", lane: "POST_REVIEW", due });
    s.clock.set(due);
    expect((await runSweep(s.deps)).postReviewBreached).toBe(1);
    expect((await runSweep(s.deps)).postReviewBreached).toBe(0);
    expect(s.store.cases.get("p1")).toMatchObject({ status: "OPEN", priority: 100 });
    expect(s.store.targets.get("REVIEW:r-p1")!.status).toBe("PUBLISHED");
    s.clock.set(addHours(due, 144));
    expect((await runSweep(s.deps)).postReviewLapsed).toBe(1);
    expect(s.store.cases.get("p1")).toMatchObject({ status: "RESOLVED", resolutionCode: "POST_REVIEW_LAPSED" });
    expect(s.store.targets.get("REVIEW:r-p1")!.status).toBe("PUBLISHED"); // lapse keeps content live
  });
  it("TMR-006 approve vs expire at the same FakeClock instant: exactly one effect", async () => {
    const s = setup();
    const deadline = s.clock.now();
    const c = s.add({ id: "h1", status: "HIDDEN", lane: "HOLD", hold: deadline });
    c.assignedToId = "m1"; c.leaseExpiresAt = addMinutes(deadline, 5);
    const { transition } = await import("@rp/core");
    const approve = transition({ store: s.store, clock: s.clock, config: cfg, reasonCodes: REASONS }, { target: { type: "REVIEW", id: "r-h1" }, event: "STAFF_APPROVE", actor: { kind: "MOD", id: "m1" }, caseId: "h1" }).then((r) => r.applied, () => false);
    const sweep = runSweep(s.deps).then((r) => r.holdExpired > 0);
    const [a, b] = await Promise.all([approve, sweep]);
    expect(Number(a) + Number(b)).toBe(1);
    expect(s.store.audits).toHaveLength(1);
  });
  it("TMR-013 delayed job with a stale deadline is a no-op; a matching one applies (MT-1)", async () => {
    const s = setup();
    const deadline = s.clock.now();
    s.add({ id: "h1", status: "HIDDEN", lane: "HOLD", hold: deadline });
    const t = { caseId: "h1", target: { type: "REVIEW" as const, id: "r-h1" } };
    expect(await holdExpire(s.deps, { ...t, deadlineMs: deadline.getTime() - 5 })).toBe("noop");
    expect(await holdExpire(s.deps, { ...t, deadlineMs: deadline.getTime() })).toBe("applied");
    expect(await holdExpire(s.deps, { ...t, deadlineMs: deadline.getTime() })).toBe("noop");
    expect(await postReviewLapse(s.deps, { ...t, deadlineMs: 0 })).toBe("noop");
  });
  it("delayed-job schedule: id embeds the deadline, delay = deadline - now (>= 0)", () => {
    const s = setup();
    const d = addHours(s.clock.now(), 168);
    expect(scheduleFor("hold", "c1", d, s.clock, cfg)).toEqual({ name: "moderation.hold-expire", jobId: holdExpireJobId("c1", d), delay: 168 * 3_600_000 });
    expect(scheduleFor("hold", "c1", addHours(d, -999), s.clock, cfg).delay).toBe(0);
    expect(scheduleFor("postReview", "c1", addHours(s.clock.now(), 24), s.clock, cfg).delay).toBe((24 + 144) * 3_600_000);
  });
  it("TMR-012 appeal SLA bumps priority and alerts, never decides; REPORTED over SLA only alerts; approvals expire", async () => {
    const s = setup();
    const alerts: string[] = [];
    s.ports.appeals.push({ id: "ap1", slaDueAt: addHours(s.clock.now(), 72), priority: 0 });
    s.add({ id: "rep1", status: "PUBLISHED", lane: "REPORTED" });
    s.store.cases.get("rep1")!.slaDueAt = addHours(s.clock.now(), 48);
    s.ports.pendingApprovals.push({ id: "x", expiresAt: addHours(s.clock.now(), 24) });
    s.clock.advance(72 * 3_600_000);
    const r = await runSweep({ ...s.deps, alert: (k) => void alerts.push(k) });
    expect(r).toMatchObject({ appealSla: 1, reportedOverSla: 1, approvalsExpired: 1 });
    expect(alerts.sort()).toEqual(["appeal_sla", "reported_over_sla"]);
    expect(s.store.targets.get("REVIEW:r-rep1")!.status).toBe("PUBLISHED");
  });
  it("TMR-011 deferred AI strikes are issued once when the appeal window closes", async () => {
    const s = setup();
    s.ports.strikes.push({ caseId: "c9", userId: "u1", transition: "T3" });
    expect((await runSweep(s.deps)).deferredStrikes).toBe(1);
    expect((await runSweep(s.deps)).deferredStrikes).toBe(0);
  });
});
