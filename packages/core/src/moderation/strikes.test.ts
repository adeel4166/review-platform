import { describe, expect, it } from "vitest";
import { authorizeSystem } from "../authz/system-principal";
import { addDays } from "../clock";
import { countStrikes, ladderFor, strikeTiming } from "./strikes";

describe("STR-001 strike ladder and the never-strike list", () => {
  it("ladder 1..5+", () => {
    expect(ladderFor(0)).toBeNull();
    expect(ladderFor(1)).toMatchObject({ type: "WARNING", reasonCode: "STRIKE_LADDER_1" });
    expect(ladderFor(2)).toMatchObject({ type: "WARNING" });
    expect(ladderFor(3)).toMatchObject({ type: "POSTING_RESTRICTION", days: 7 });
    expect(ladderFor(4)).toMatchObject({ days: 30 });
    expect(ladderFor(5)).toMatchObject({ days: null, escalate: true });
    expect(ladderFor(9)).toMatchObject({ reasonCode: "STRIKE_LADDER_5", escalate: true });
  });
  it("human removes strike now; AI/RULE violations strike at window close", () => {
    for (const t of ["T6", "T9", "T17", "T21", "R6"]) expect(strikeTiming({ transition: t })).toBe("NOW");
    for (const t of ["T3", "T4v", "R3"]) expect(strikeTiming({ transition: t })).toBe("WINDOW_CLOSE");
  });
  it("never: HOLD_EXPIRED, POST_REVIEW_LAPSED, overturned, fixed by T20 (MOD-008)", () => {
    expect(strikeTiming({ transition: "T7", resolutionCode: "HOLD_EXPIRED" })).toBe("NEVER");
    expect(strikeTiming({ transition: "T10", resolutionCode: "POST_REVIEW_LAPSED" })).toBe("NEVER");
    expect(strikeTiming({ transition: "T6", overturned: true })).toBe("NEVER");
    expect(strikeTiming({ transition: "T3", fixedByResubmit: true })).toBe("NEVER");
    expect(strikeTiming({ transition: "T13" })).toBe("NEVER");
  });
  it("counts the rolling 180 days and ignores overturned (MOD-013)", () => {
    const now = new Date("2027-06-01T00:00:00Z");
    const rows = [{ startsAt: addDays(now, -10), status: "ACTIVE" as const }, { startsAt: addDays(now, -179), status: "EXPIRED" as const }, { startsAt: addDays(now, -181), status: "ACTIVE" as const }, { startsAt: addDays(now, -5), status: "OVERTURNED" as const }];
    expect(countStrikes(rows, now)).toBe(2);
  });
});

describe("AZ-017 system principal allow-list", () => {
  it("allows decision writes, WARNING, CONTENT_REMOVAL and ladder restrictions", () => {
    expect(authorizeSystem({ kind: "decision.write" })).toBe(true);
    expect(authorizeSystem({ kind: "enforcement.issue", type: "WARNING" })).toBe(true);
    expect(authorizeSystem({ kind: "enforcement.issue", type: "CONTENT_REMOVAL" })).toBe(true);
    expect(authorizeSystem({ kind: "enforcement.issue", type: "POSTING_RESTRICTION", reasonCode: "STRIKE_LADDER_3" })).toBe(true);
  });
  it("protective SUSPENSION only with a zero-tolerance verdict", () => {
    expect(authorizeSystem({ kind: "enforcement.issue", type: "SUSPENSION", reasonCode: "ZERO_TOLERANCE_HOLD", zeroToleranceVerdict: true })).toBe(true);
    expect(authorizeSystem({ kind: "enforcement.issue", type: "SUSPENSION", reasonCode: "ZERO_TOLERANCE_HOLD" })).toBe(false);
    expect(authorizeSystem({ kind: "enforcement.issue", type: "SUSPENSION", reasonCode: "OTHER", zeroToleranceVerdict: true })).toBe(false);
  });
  it("denies BAN, SELLER_*, VERIFIED_LABEL_REVOKED, role.*, config.*, restrictions outside the ladder", () => {
    for (const type of ["BAN", "SELLER_SUSPENSION", "SELLER_REPLY_RESTRICTION", "VERIFIED_LABEL_REVOKED", "VOTING_RESTRICTION"]) expect(authorizeSystem({ kind: "enforcement.issue", type, zeroToleranceVerdict: true })).toBe(false);
    expect(authorizeSystem({ kind: "enforcement.issue", type: "POSTING_RESTRICTION", reasonCode: "MANUAL" })).toBe(false);
    for (const kind of ["role.grant", "config.activate", "anything.else"]) expect(authorizeSystem({ kind })).toBe(false);
  });
});
