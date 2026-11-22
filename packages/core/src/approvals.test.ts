import { describe, expect, it } from "vitest";
import { FakeClock } from "./testing/fake-clock";
import { addHours } from "./clock";
import { ApprovalError, assertCanApprove, roleGrantNeedsFourEyes, approvalExpiry, targetKeyFor, type ApprovalRec } from "./approvals";
import { BREAK_GLASS_HEADERS, BreakGlassError, assertAccessUsable, decideBreakGlass } from "./break-glass";

const clock = new FakeClock();
const req = (o: Partial<ApprovalRec> = {}): ApprovalRec => ({ kind: "CONFIG_ACTIVATION", status: "PENDING", requestedById: "a1", expiresAt: approvalExpiry(clock), payloadHash: "h", ...o });

describe("four-eyes (CFG-004, SEC-010, AZ-015, AZ-024)", () => {
  it("self-approval is refused", () => expect(() => assertCanApprove(req(), { id: "a1", roles: ["ADMIN"] }, clock, "h")).toThrow(expect.objectContaining({ code: "approval_self", status: 403 })));
  it("a second ADMIN may approve a config activation", () => expect(() => assertCanApprove(req(), { id: "a2", roles: ["ADMIN"] }, clock, "h")).not.toThrow());
  it("a MODERATOR cannot approve", () => expect(() => assertCanApprove(req(), { id: "m", roles: ["MODERATOR"] }, clock, "h")).toThrow(ApprovalError));
  it("expired at +24 h and stale payloads are refused", () => {
    const r = req();
    clock.set(addHours(r.expiresAt, 0));
    expect(() => assertCanApprove(r, { id: "a2", roles: ["ADMIN"] }, clock, "h")).toThrow(expect.objectContaining({ code: "approval_expired" }));
    clock.set("2027-01-04T09:00:00.000Z");
    expect(() => assertCanApprove(r, { id: "a2", roles: ["ADMIN"] }, clock, "changed")).toThrow(expect.objectContaining({ code: "approval_stale" }));
    expect(() => assertCanApprove(req({ status: "EXECUTED" }), { id: "a2", roles: ["ADMIN"] }, clock, "h")).toThrow(expect.objectContaining({ code: "not_pending" }));
  });
  it("role grants: senior+ roles need four-eyes, MODERATOR does not; approver must be SUPER_ADMIN", () => {
    expect(roleGrantNeedsFourEyes("MODERATOR")).toBe(false);
    for (const r of ["SENIOR_MODERATOR", "ADMIN", "SUPER_ADMIN"] as const) expect(roleGrantNeedsFourEyes(r)).toBe(true);
    expect(() => assertCanApprove(req({ kind: "ROLE_GRANT" }), { id: "a2", roles: ["ADMIN"] }, clock, "h")).toThrow(expect.objectContaining({ code: "forbidden" }));
    expect(() => assertCanApprove(req({ kind: "ROLE_GRANT" }), { id: "s2", roles: ["SUPER_ADMIN"] }, clock, "h")).not.toThrow();
  });
  it("AZ-024 2FA reset and APL-004 BAN overturn use the same distinct-approver rule", () => {
    for (const kind of ["TWO_FACTOR_RESET", "ENFORCEMENT_OVERTURN_MAJOR"] as const) expect(() => assertCanApprove(req({ kind }), { id: "a1", roles: ["SUPER_ADMIN", "SENIOR_MODERATOR"] }, clock, "h")).toThrow(expect.objectContaining({ code: "approval_self" }));
    expect(targetKeyFor.role("u", "ADMIN")).toBe("role:u:ADMIN");
  });
});

describe("break-glass (PRV-003, BGL-001)", () => {
  const base = { clock, reasonText: "Customer disputes the order id on the proof", stepUpAt: clock.now().getTime() - 60_000, originalExists: true, staffId: "s1", submitterId: "u1", accessesToday: 0, recentSameSubmitter: 0 };
  it("grants a 60 s access", () => expect(decideBreakGlass(base)).toEqual({ kind: "grant", expiresAt: new Date(clock.now().getTime() + 60_000), alert: false }));
  it("reason 20-500 chars, step-up within 10 min, original must exist", () => {
    expect(() => decideBreakGlass({ ...base, reasonText: "too short" })).toThrow(expect.objectContaining({ code: "reason_invalid" }));
    expect(() => decideBreakGlass({ ...base, reasonText: "x".repeat(501) })).toThrow(expect.objectContaining({ code: "reason_invalid" }));
    expect(() => decideBreakGlass({ ...base, stepUpAt: clock.now().getTime() - 11 * 60_000 })).toThrow(expect.objectContaining({ code: "step_up_required" }));
    expect(() => decideBreakGlass({ ...base, stepUpAt: null })).toThrow(BreakGlassError);
    expect(() => decideBreakGlass({ ...base, originalExists: false })).toThrow(expect.objectContaining({ code: "original_purged", status: 410 }));
  });
  it("daily cap 20 (alert at 10, 21st refused) and repeat on one submitter needs approval", () => {
    expect(decideBreakGlass({ ...base, accessesToday: 9 })).toMatchObject({ kind: "grant", alert: true });
    expect(() => decideBreakGlass({ ...base, accessesToday: 20 })).toThrow(expect.objectContaining({ code: "break_glass_cap", status: 429 }));
    expect(decideBreakGlass({ ...base, recentSameSubmitter: 1 })).toEqual({ kind: "needs_approval" });
  });
  it("staff cannot open their own proof", () => expect(() => decideBreakGlass({ ...base, staffId: "u1" })).toThrow(expect.objectContaining({ code: "conflict_of_interest" })));
  it("BGL-001 single-use, session-bound, expires after 60 s", () => {
    const a = { staffId: "s1", sessionId: "sess", expiresAt: new Date(clock.now().getTime() + 60_000), usedAt: null as Date | null };
    expect(() => assertAccessUsable(a, { staffId: "s1", sessionId: "sess" }, clock)).not.toThrow();
    expect(() => assertAccessUsable(a, { staffId: "s1", sessionId: "other" }, clock)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => assertAccessUsable(a, { staffId: "s2", sessionId: "sess" }, clock)).toThrow(BreakGlassError);
    expect(() => assertAccessUsable({ ...a, usedAt: clock.now() }, { staffId: "s1", sessionId: "sess" }, clock)).toThrow(expect.objectContaining({ code: "access_used" }));
    clock.advance(60_000);
    expect(() => assertAccessUsable(a, { staffId: "s1", sessionId: "sess" }, clock)).toThrow(expect.objectContaining({ code: "access_expired" }));
    clock.set("2027-01-04T09:00:00.000Z");
  });
  it("served with no-store / sandbox / nosniff headers", () => {
    expect(BREAK_GLASS_HEADERS["Cache-Control"]).toBe("no-store");
    expect(BREAK_GLASS_HEADERS["Content-Security-Policy"]).toContain("sandbox");
    expect(BREAK_GLASS_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
  });
});
