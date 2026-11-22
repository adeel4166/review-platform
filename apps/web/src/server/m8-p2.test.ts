/** M8-01 remaining P2s (SEC-M6-07/08/09, SEC-M7-04 web side). Test code only. */
import { describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
vi.mock("@/server/auth", () => ({ auth: () => authMock() }));
vi.mock("@/server/db", () => ({ db: {} }));

import { fileAppeal, loadAppellant } from "./appeals";
import { requestOriginalAccess } from "./break-glass";
import { makeAlert, staffOf, STAFF_ROLES } from "./m6-routes";
import { requireAdmin, requireModerator } from "./session";
import { putVote } from "./votes";
import { sharedIpWeight } from "@rp/core";
import { makeFakeDb } from "./m4-fake-db";

const clock = { now: () => new Date("2027-03-01T00:00:00Z") };
const config = new Proxy({}, { get: () => new Proxy({}, { get: () => 72 }) }) as never;

describe("SEC-M6-07 appeal trustBand and limiter args", () => {
  const mk = (band: string) => {
    const cases = [{ id: "c1", version: 1, authorId: "author", appealableUntil: new Date("2027-04-01"), resolutionCode: "REJECT" }];
    const tx = { user: { findUnique: async () => ({ trustBand: band }) }, moderationCase: { findUnique: async () => cases[0] }, moderationDecision: { findFirst: async () => ({ contentVersion: 1 }) }, report: { findFirst: async () => ({ id: "r" }) }, appeal: { findFirst: async () => null, create: async () => ({ id: "a1" }) }, auditLog: { create: async () => ({}) }, outboxEvent: { create: async () => ({}) } };
    return { db: { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as never, clock, config, limit: vi.fn(async () => true), applyOverturn: async () => {} };
  };
  it("loads the band from the database and a NEW reporter gets 403 (AP-3)", async () => {
    const d = mk("NEW");
    const u = await loadAppellant(d.db, "reporter");
    expect(u).toEqual({ id: "reporter", trustBand: "NEW" });
    await expect(fileAppeal(d, u, { caseId: "c1", statement: "this decision was wrong", asReporter: true })).rejects.toMatchObject({ status: 403 });
  });
  it("a non-NEW reporter is allowed and the limiter receives its max and window", async () => {
    const d = mk("MEDIUM");
    await expect(fileAppeal(d, await loadAppellant(d.db, "reporter"), { caseId: "c1", statement: "this decision was wrong", asReporter: true })).resolves.toEqual({ id: "a1" });
    expect(d.limit).toHaveBeenCalledWith("appeal.create:reporter", 3, 86400);
  });
});

describe("SEC-M6-08 alert sink and empty session id", () => {
  it("alerts are enqueued to the outbox (real sink), keeping only scalar details", async () => {
    const created: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    makeAlert({ outboxEvent: { create: async (a) => { created.push(a); } } })("break_glass_cap", { staffId: "s1", nested: { pii: "x" } });
    await Promise.resolve();
    expect(created[0]).toMatchObject({ data: { type: "security.alert", payload: { kind: "break_glass_cap", staffId: "s1" } } });
    expect(JSON.stringify(created[0])).not.toContain("pii");
  });
  it("staff sessions without a sid are rejected, in the mapper and in break-glass", async () => {
    expect(() => staffOf({ id: "s1", role: "admin" } as never)).toThrow(/Sign in/);
    await expect(requestOriginalAccess({ $transaction: async () => { throw new Error("must not run"); } } as never, { id: "s1", roles: ["ADMIN"], sessionId: "" } as never, { proofId: "p", fileId: "f", reasonCode: "X", reasonText: "y" }, clock, () => undefined)).rejects.toMatchObject({ status: 401 });
  });
});

describe("SEC-M6-09 MODERATOR / SENIOR_MODERATOR roles are live and least-privilege", () => {
  it("staffOf maps them so four-eyes approver roles can be satisfied", () => {
    expect(staffOf({ id: "m", role: "senior_moderator", sid: "s" } as never).roles).toEqual(["SENIOR_MODERATOR", "MODERATOR"]);
    expect(STAFF_ROLES.user).toBeUndefined();
  });
  const as = (role: string) => authMock.mockResolvedValue({ user: { id: "u", role, sid: "s", twoFactor: { enrolled: true, verified: true } } });
  it("moderators pass the moderation gate but never the admin gate (proofs, break-glass, config, roles)", async () => {
    as("moderator");
    await expect(requireModerator()).resolves.toMatchObject({ id: "u" });
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
    as("user");
    await expect(requireModerator()).rejects.toMatchObject({ status: 403 });
  });
});

describe("SEC-M7-04 vote weight and ipHash interplay", () => {
  it("shared-IP weight is 0 at the per-IP limit and unaffected without an ipHash", () => {
    expect(sharedIpWeight(1, 2)).toBe(1);
    expect(sharedIpWeight(1, 3)).toBe(0);
  });
  it("a vote from an IP that already cast 3 votes in 24 h is stored with weight 0 and does not move counters", async () => {
    const h = makeFakeDb(["user", "review", "product", "reviewVote", "sellerMember", "enforcementAction"], {}, { review: { helpfulCount: 0, notHelpfulCount: 0 } });
    h.t.user!.push({ id: "v", emailVerifiedAt: new Date("2026-01-01"), createdAt: new Date("2026-01-01"), status: "ACTIVE", trustBand: "HIGH" });
    h.t.review!.push({ id: "r", authorId: "a", status: "PUBLISHED", productId: "p", helpfulCount: 0, notHelpfulCount: 0, product: { sellerId: null } });
    const ip = "a".repeat(64), now = new Date("2027-03-01T00:00:00Z");
    for (const i of [1, 2, 3]) h.t.reviewVote!.push({ id: `o${i}`, reviewId: "r", userId: `x${i}`, ipHash: ip, value: "HELPFUL", weight: 1, frozen: false, createdAt: new Date(now.getTime() - 3_600_000) });
    await putVote(h.db as never, "v", "r", "HELPFUL", { ipHash: ip, now });
    expect(h.t.reviewVote!.find((v) => v.userId === "v")!.weight).toBe(0);
    expect(h.t.review![0]!.helpfulCount).toBe(0);
  });
});
