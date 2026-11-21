import { describe, expect, it } from "vitest";
import {
  CLAIM_CONFIG, CLAIM_TRANSITIONS, DAY_MS, InvalidClaimTransitionError, SelfDecisionError, applyClaimTransition, canAutoApprove, createFakeClaimDb, decideReverify,
  evaluateObservedTokens, generateChallenge, nextCheckAt, reviewRequirements, ClaimConflictOfInterestError, ContestWindowOpenError, DuplicateApprovalError,
  type ClaimAction, type ClaimStatus,
} from "./index";

const T0 = new Date("2026-12-01T00:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const SYS = { id: null, type: "SYSTEM" as const };
const STATUSES: ClaimStatus[] = ["PENDING", "VERIFIED", "REJECTED", "CONTESTED", "EXPIRED", "REVOKED", "WITHDRAWN"];

function world() {
  const db = createFakeClaimDb({
    user: [{ id: "u1", status: "ACTIVE", emailVerifiedAt: T0 }, { id: "u2", status: "ACTIVE", emailVerifiedAt: T0 }, { id: "admin1" }, { id: "admin2" }, { id: "admin3" }],
    seller: [{ id: "A", status: "PENDING_VERIFICATION", closedAt: null }, { id: "B", status: "VERIFIED", closedAt: null }],
    sellerMember: [{ sellerId: "A", userId: "u1", role: "OWNER" }, { sellerId: "B", userId: "u2", role: "OWNER" }],
  });
  const claim = (over: Record<string, unknown> = {}) => {
    const r = {
      id: "c1", sellerId: "A", scope: "SELLER", productId: null, method: "DNS_TXT", status: "PENDING", domain: "acme.com", challengeValue: "tok-A", challengeExpiresAt: at(72 * 3600_000),
      requiresHumanReview: false, requiredApprovals: 1, conflictClaimId: null, checkAttempts: 0, lastCheckAt: null, lastCheckOutcome: null, activeKey: "A|SELLER|acme.com",
      verifiedDomainKey: null, submittedById: "u1", graceEndsAt: null, reverifyFailingSince: null, verifiedUntil: null, verifiedAt: null, ...over,
    };
    db.t.sellerOwnershipClaim!.push(r);
    return r;
  };
  return { db, claim };
}

describe("challenge (SEL-001)", () => {
  it("is >= 128 bits (256), random and unique", () => {
    const set = new Set(Array.from({ length: 200 }, generateChallenge));
    expect(set.size).toBe(200);
    for (const v of set) expect(Buffer.from(v, "base64url").length).toBeGreaterThanOrEqual(16);
    expect(Buffer.from([...set][0]!, "base64url").length).toBe(32);
  });
  it("only the claim's own value passes: another claim's token on the same domain fails, and nothing passes after expiry", () => {
    const x = { challengeValue: generateChallenge(), challengeExpiresAt: at(1000) };
    const y = { challengeValue: generateChallenge(), challengeExpiresAt: at(1000) };
    expect(evaluateObservedTokens(x, [x.challengeValue], T0)).toBe("PASS");
    expect(evaluateObservedTokens(y, [x.challengeValue], T0)).toBe("MISMATCH");
    expect(evaluateObservedTokens(x, [], T0)).toBe("NOT_FOUND");
    expect(evaluateObservedTokens(x, [x.challengeValue], at(1000))).toBe("NOT_FOUND");
  });
  it("backs off 5m, 15m, 1h, 6h, 24h, 48h and never beyond the challenge expiry", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((a) => nextCheckAt(a, T0, null).getTime() - T0.getTime())).toEqual([...CLAIM_CONFIG.backoffMs, CLAIM_CONFIG.backoffMs[5]]);
    expect(nextCheckAt(5, T0, at(1000))).toEqual(at(1000));
  });
});

describe("who decides (SEL-004, SEL-015)", () => {
  const base = { scope: "SELLER" as const, brandHasExistingClaim: false, reviewCount: 0, nameReviewFlag: false };
  it("DOCUMENT and MARKETPLACE always need a human", () => {
    for (const method of ["DOCUMENT", "MARKETPLACE"] as const) expect(reviewRequirements({ ...base, method }).requiresHumanReview).toBe(true);
    expect(reviewRequirements({ ...base, method: "DNS_TXT" }).requiresHumanReview).toBe(false);
  });
  it("a second reviewer for brands with an existing claim, high volume and flagged names", () => {
    expect(reviewRequirements({ ...base, method: "DOCUMENT" }).requiredApprovals).toBe(1);
    expect(reviewRequirements({ ...base, method: "DOCUMENT", brandHasExistingClaim: true }).requiredApprovals).toBe(2);
    expect(reviewRequirements({ ...base, method: "DOCUMENT", reviewCount: 500 }).requiredApprovals).toBe(2);
    expect(reviewRequirements({ ...base, scope: "PRODUCT", method: "DOCUMENT", reviewCount: 50 }).requiredApprovals).toBe(2);
    expect(reviewRequirements({ ...base, method: "DOCUMENT", nameReviewFlag: true }).requiredApprovals).toBe(2);
  });
  it("auto-approval needs every condition", () => {
    const ok = { method: "DNS_TXT" as const, scope: "SELLER" as const, outcome: "PASS" as const, requiresHumanReview: false, hasConflict: false, claimantIsOwnerOrManager: true, claimantEmailVerified: true, sellerBlocked: false, challengeUnexpired: true };
    expect(canAutoApprove(ok)).toBe(true);
    for (const o of [{ method: "DOCUMENT" }, { method: "MARKETPLACE" }, { scope: "PRODUCT" }, { outcome: "MISMATCH" }, { requiresHumanReview: true }, { hasConflict: true }, { claimantIsOwnerOrManager: false }, { claimantEmailVerified: false }, { sellerBlocked: true }, { challengeUnexpired: false }]) {
      expect(canAutoApprove({ ...ok, ...o } as never)).toBe(false);
    }
  });
});

describe("state machine (SEL-014)", () => {
  it("every status x action outside the table is invalid_transition, with no row change and no audit row", async () => {
    for (const status of STATUSES) {
      for (const action of Object.keys(CLAIM_TRANSITIONS) as ClaimAction[]) {
        if (CLAIM_TRANSITIONS[action].includes(status)) continue;
        const { db, claim } = world();
        claim({ status });
        const before = JSON.stringify(db.t.sellerOwnershipClaim);
        const input = { action, outcome: "NOT_FOUND", reviewerId: "admin1", reasonCode: "X_REASON", pass: true } as never;
        await expect(applyClaimTransition(db, "c1", input, SYS, T0)).rejects.toBeInstanceOf(InvalidClaimTransitionError);
        expect(JSON.stringify(db.t.sellerOwnershipClaim)).toBe(before);
        expect(db.t.auditLog).toHaveLength(0);
      }
    }
  });
});

describe("automatic verification and contest (SEL-003, SEL-005)", () => {
  it("DNS pass auto-approves: claim VERIFIED, seller VERIFIED, domain key set, audit has ids only", async () => {
    const { db, claim } = world();
    claim();
    const r = await applyClaimTransition(db, "c1", { action: "CHECK_PASSED", observed: ["tok-A"], rand: () => 9999 }, SYS, T0);
    expect(r.status).toBe("VERIFIED");
    const c = db.t.sellerOwnershipClaim![0]!;
    expect(c.verifiedDomainKey).toBe("acme.com");
    expect(c.verifiedUntil).toEqual(at(CLAIM_CONFIG.validityMs));
    expect(db.t.seller!.find((s) => s.id === "A")!.status).toBe("VERIFIED");
    expect(db.t.outboxEvent!.map((o) => o.type)).toContain("claim.verified");
    expect(JSON.stringify(db.t.auditLog)).not.toMatch(/tok-A|@/);
  });
  it("a wrong observed token never verifies", async () => {
    const { db, claim } = world();
    claim();
    await expect(applyClaimTransition(db, "c1", { action: "CHECK_PASSED", observed: ["other"] }, SYS, T0)).rejects.toThrow("challenge_mismatch");
  });
  it("DOCUMENT/MARKETPLACE are never machine-verified", async () => {
    const { db, claim } = world();
    claim({ method: "DOCUMENT", domain: null, challengeValue: null, requiresHumanReview: true });
    expect((await applyClaimTransition(db, "c1", { action: "CHECK_PASSED" }, SYS, T0)).changed).toBe(false);
    expect(db.t.sellerOwnershipClaim![0]!.status).toBe("PENDING");
  });
  it("a domain VERIFIED for another seller gives CONTESTED, notifies via outbox, leaves the incumbent untouched and needs 2 approvals", async () => {
    const { db, claim } = world();
    db.t.sellerOwnershipClaim!.push({ id: "inc", sellerId: "B", scope: "SELLER", method: "DNS_TXT", status: "VERIFIED", domain: "acme.com", verifiedDomainKey: "acme.com", activeKey: "B|SELLER|acme.com", submittedById: "u2", verifiedAt: T0, verifiedUntil: at(CLAIM_CONFIG.validityMs) });
    claim();
    const r = await applyClaimTransition(db, "c1", { action: "CHECK_PASSED", observed: ["tok-A"] }, SYS, T0);
    expect(r).toMatchObject({ status: "CONTESTED", contested: true });
    const c = db.t.sellerOwnershipClaim!.find((x) => x.id === "c1")!;
    expect(c).toMatchObject({ conflictClaimId: "inc", requiredApprovals: 2 });
    expect(c.contestResponseDueAt).toEqual(at(CLAIM_CONFIG.contestResponseMs));
    expect(db.t.outboxEvent!.some((o) => o.type === "claim.contested" && o.aggregateId === "c1")).toBe(true);
    expect(db.t.sellerOwnershipClaim!.find((x) => x.id === "inc")!.status).toBe("VERIFIED");
    // staff: not before the response window
    await expect(applyClaimTransition(db, "c1", { action: "STAFF_APPROVE", reviewerId: "admin1" }, { id: "admin1", type: "STAFF" }, at(DAY_MS))).rejects.toBeInstanceOf(ContestWindowOpenError);
    const after = at(8 * DAY_MS);
    expect((await applyClaimTransition(db, "c1", { action: "STAFF_APPROVE", reviewerId: "admin1" }, { id: "admin1", type: "STAFF" }, after)).status).toBe("CONTESTED");
    await expect(applyClaimTransition(db, "c1", { action: "STAFF_APPROVE", reviewerId: "admin1" }, { id: "admin1", type: "STAFF" }, after)).rejects.toBeInstanceOf(DuplicateApprovalError);
    // T-05: the PASS from 8 days ago is too old for the final approval; a fresh check is needed first
    await expect(applyClaimTransition(db, "c1", { action: "STAFF_APPROVE", reviewerId: "admin2" }, { id: "admin2", type: "STAFF" }, after)).rejects.toMatchObject({ message: "evidence_stale" });
    c.lastCheckAt = after;
    const fin = await applyClaimTransition(db, "c1", { action: "STAFF_APPROVE", reviewerId: "admin2" }, { id: "admin2", type: "STAFF" }, after);
    expect(fin.status).toBe("VERIFIED");
    const inc = db.t.sellerOwnershipClaim!.find((x) => x.id === "inc")!;
    expect(inc).toMatchObject({ status: "REVOKED", endReason: "CONTEST_LOST", verifiedDomainKey: null });
    expect(db.t.seller!.find((s) => s.id === "B")!.status).toBe("UNVERIFIED"); // incumbent downgraded
    expect(db.t.seller!.find((s) => s.id === "A")!.status).toBe("VERIFIED");
  });
  it("the DB guarantee: a second VERIFIED claim on one domain is refused (unique verifiedDomainKey)", async () => {
    const { db, claim } = world();
    db.t.sellerOwnershipClaim!.push({ id: "inc", sellerId: "B", scope: "SELLER", method: "DNS_TXT", status: "VERIFIED", domain: "acme.com", verifiedDomainKey: "acme.com", activeKey: "x" });
    claim({ method: "DOCUMENT", challengeValue: null, requiresHumanReview: true });
    await expect(db.sellerOwnershipClaim.update({ where: { id: "c1" }, data: { verifiedDomainKey: "acme.com" } })).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("staff decisions (SEL-004, self-decision, COI)", () => {
  const staff = (id: string) => ({ id, type: "STAFF" as const });
  it("a DOCUMENT claim needs a human; requiredApprovals=2 needs two distinct reviewers", async () => {
    const { db, claim } = world();
    claim({ method: "DOCUMENT", domain: null, challengeValue: null, challengeExpiresAt: null, requiresHumanReview: true, requiredApprovals: 2, activeKey: "A|SELLER|DOCUMENT" });
    expect((await applyClaimTransition(db, "c1", { action: "STAFF_APPROVE", reviewerId: "admin1" }, staff("admin1"), T0)).status).toBe("PENDING");
    await expect(applyClaimTransition(db, "c1", { action: "STAFF_APPROVE", reviewerId: "admin1" }, staff("admin1"), T0)).rejects.toBeInstanceOf(DuplicateApprovalError);
    expect((await applyClaimTransition(db, "c1", { action: "STAFF_APPROVE", reviewerId: "admin2" }, staff("admin2"), T0)).status).toBe("VERIFIED");
  });
  it("one reviewer is enough for a 1-approval claim, one REJECT ends any claim", async () => {
    const a = world();
    a.claim({ method: "DOCUMENT", domain: null, challengeValue: null, requiresHumanReview: true });
    expect((await applyClaimTransition(a.db, "c1", { action: "STAFF_APPROVE", reviewerId: "admin1" }, staff("admin1"), T0)).status).toBe("VERIFIED");
    const b = world();
    b.claim({ method: "DOCUMENT", domain: null, challengeValue: null, requiresHumanReview: true, requiredApprovals: 2 });
    const r = await applyClaimTransition(b.db, "c1", { action: "STAFF_REJECT", reviewerId: "admin1", reasonCode: "FORGED" }, staff("admin1"), T0);
    expect(r.status).toBe("REJECTED");
    expect(b.db.t.sellerOwnershipClaim![0]).toMatchObject({ activeKey: null, endedAt: T0 });
  });
  it("self-decision is forbidden (SelfDecisionError) and members of either seller are in conflict of interest", async () => {
    const { db, claim } = world();
    claim({ method: "DOCUMENT", domain: null, challengeValue: null, requiresHumanReview: true });
    await expect(applyClaimTransition(db, "c1", { action: "STAFF_APPROVE", reviewerId: "u1" }, staff("u1"), T0)).rejects.toBeInstanceOf(SelfDecisionError);
    await expect(applyClaimTransition(db, "c1", { action: "STAFF_REJECT", reviewerId: "u1", reasonCode: "NOPE_X" }, staff("u1"), T0)).rejects.toBeInstanceOf(SelfDecisionError);
    db.t.sellerMember!.push({ sellerId: "A", userId: "admin3", role: "RESPONDER" });
    await expect(applyClaimTransition(db, "c1", { action: "STAFF_APPROVE", reviewerId: "admin3" }, staff("admin3"), T0)).rejects.toBeInstanceOf(ClaimConflictOfInterestError);
    expect(db.t.sellerOwnershipClaim![0]!.status).toBe("PENDING");
  });
  it("a staff approval of a manual claim on a VERIFIED domain opens the contest instead (C5), counting no approval", async () => {
    const { db, claim } = world();
    db.t.sellerOwnershipClaim!.push({ id: "inc", sellerId: "B", scope: "SELLER", method: "DNS_TXT", status: "VERIFIED", domain: "acme.com", verifiedDomainKey: "acme.com", activeKey: "x" });
    claim({ method: "MARKETPLACE", challengeValue: "m", requiresHumanReview: true });
    const r = await applyClaimTransition(db, "c1", { action: "STAFF_APPROVE", reviewerId: "admin1" }, staff("admin1"), T0);
    expect(r.status).toBe("CONTESTED");
    expect(db.t.sellerClaimDecision).toHaveLength(0);
  });
});

describe("re-verification, grace and downgrade with a fake clock (SEL-008, SEL-016)", () => {
  const verified = () => {
    const w = world();
    w.claim({ status: "VERIFIED", verifiedAt: T0, verifiedUntil: at(CLAIM_CONFIG.validityMs), verifiedDomainKey: "acme.com", lastCheckAt: T0, lastCheckOutcome: "PASS" });
    w.db.t.seller![0]!.status = "VERIFIED";
    return w;
  };
  it("pure decisions: pass renews; first failure enters grace; failure after grace expires", () => {
    const c = { method: "DNS_TXT" as const, verifiedUntil: at(CLAIM_CONFIG.validityMs), lastCheckAt: T0, graceEndsAt: null, lastCheckOutcome: "PASS" as const };
    expect(decideReverify(c, "PASS", at(31 * DAY_MS))).toBe("RENEW");
    expect(decideReverify(c, "NOT_FOUND", at(31 * DAY_MS))).toBe("ENTER_GRACE");
    const g = { ...c, graceEndsAt: at(45 * DAY_MS) };
    expect(decideReverify(g, "NOT_FOUND", at(40 * DAY_MS))).toBe("NONE");
    expect(decideReverify(g, "NOT_FOUND", at(46 * DAY_MS))).toBe("EXPIRE_GRACE");
  });
  it("failure -> 14-day grace (badge stays) -> downgrade, and a pass inside the grace clears it", async () => {
    const { db } = verified();
    const day31 = at(31 * DAY_MS);
    await applyClaimTransition(db, "c1", { action: "ENTER_GRACE", outcome: "NOT_FOUND" }, SYS, day31);
    let c = db.t.sellerOwnershipClaim![0]!;
    expect(c).toMatchObject({ status: "VERIFIED", reverifyFailingSince: day31, graceEndsAt: at(45 * DAY_MS) });
    expect(db.t.seller![0]!.status).toBe("VERIFIED"); // badge stays during grace
    // not yet due
    expect((await applyClaimTransition(db, "c1", { action: "EXPIRE_GRACE" }, SYS, at(44 * DAY_MS))).changed).toBe(false);
    // a pass clears grace
    await applyClaimTransition(db, "c1", { action: "REVERIFY_PASSED" }, SYS, at(40 * DAY_MS));
    c = db.t.sellerOwnershipClaim![0]!;
    expect(c).toMatchObject({ graceEndsAt: null, reverifyFailingSince: null });
    // fail again, let the grace lapse
    await applyClaimTransition(db, "c1", { action: "ENTER_GRACE", outcome: "NOT_FOUND" }, SYS, at(70 * DAY_MS));
    const r = await applyClaimTransition(db, "c1", { action: "EXPIRE_GRACE" }, SYS, at(85 * DAY_MS));
    expect(r.status).toBe("EXPIRED");
    expect(db.t.sellerOwnershipClaim![0]).toMatchObject({ endReason: "REVERIFY_FAILED", verifiedDomainKey: null, activeKey: null });
    expect(db.t.seller![0]!.status).toBe("UNVERIFIED");
    expect(db.t.outboxEvent!.some((o) => o.type === "seller.downgraded")).toBe(true);
  });
});

describe("STAFF_APPROVE re-checks (T-05)", () => {
  const staff = { id: "admin1", type: "STAFF" as const };
  const approve = (db: ReturnType<typeof world>["db"], now = T0) => applyClaimTransition(db, "c1", { action: "STAFF_APPROVE", reviewerId: "admin1" }, staff, now);
  const passed = { lastCheckOutcome: "PASS", lastCheckAt: T0 };
  it("approves when seller is live, claimant is OWNER and evidence is fresh", async () => {
    const { db, claim } = world(); claim(passed);
    expect((await approve(db, at(3600_000))).status).toBe("VERIFIED");
  });
  for (const status of ["SUSPENDED", "CLOSED"]) {
    it(`rejects when the seller is ${status}`, async () => {
      const { db, claim } = world(); claim(passed);
      db.t.seller!.find((s) => s.id === "A")!.status = status;
      await expect(approve(db)).rejects.toMatchObject({ message: "seller_blocked" });
      expect(db.t.sellerOwnershipClaim!.find((x) => x.id === "c1")!.status).toBe("PENDING");
    });
  }
  it("rejects when the seller has closedAt set", async () => {
    const { db, claim } = world(); claim(passed);
    db.t.seller!.find((s) => s.id === "A")!.closedAt = T0;
    await expect(approve(db)).rejects.toMatchObject({ message: "seller_blocked" });
  });
  it("rejects when the claimant was removed or demoted", async () => {
    const { db, claim } = world(); claim(passed);
    db.t.sellerMember!.find((m) => m.userId === "u1")!.role = "MEMBER";
    await expect(approve(db)).rejects.toMatchObject({ message: "claimant_not_owner_or_manager" });
    db.t.sellerMember!.length = 0;
    await expect(approve(db)).rejects.toMatchObject({ message: "claimant_not_owner_or_manager" });
  });
  it("rejects auto-method evidence older than 24 h, accepts it just inside", async () => {
    const { db, claim } = world(); claim(passed);
    await expect(approve(db, at(DAY_MS + 1))).rejects.toMatchObject({ message: "evidence_stale" });
    expect((await approve(db, at(DAY_MS - 1))).status).toBe("VERIFIED");
  });
});
