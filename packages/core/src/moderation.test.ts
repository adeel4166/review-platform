import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS, FakeModerationDb, IllegalTransitionError, MODERATION_STATES, MockModerationProvider,
  StubPurchaseLookup, TRANSITIONS, TransitionConflictError, canTransition, createModerationProvider, decideVerdict,
  markVerifiedBuyer, transitionCase, type ModerationDb, type ModerationState,
} from "./index";

const asDb = (f: FakeModerationDb) => f as unknown as ModerationDb;
const staff = { type: "STAFF", id: "admin1" } as const;

describe("state machine: every (from,to) pair", () => {
  for (const from of MODERATION_STATES) {
    for (const to of MODERATION_STATES) {
      const ok = (TRANSITIONS[from] as readonly ModerationState[]).includes(to);
      it(`${from} -> ${to} is ${ok ? "allowed" : "rejected"}`, async () => {
        const f = new FakeModerationDb();
        const r = f.addReview({ status: from === "NEEDS_HUMAN" ? "HIDDEN" : "PENDING" });
        const c = f.addCase(r.id as string, from);
        const actor = from === "NEEDS_HUMAN" ? staff : ({ type: "SYSTEM" } as const);
        const p = transitionCase(asDb(f), { caseId: c.id, to, actor });
        if (ok) {
          await expect(p).resolves.toMatchObject({ state: to });
          expect(f.audit).toHaveLength(1);
        } else {
          await expect(p).rejects.toBeInstanceOf(IllegalTransitionError);
          expect(f.audit).toHaveLength(0);
          expect(c.state).toBe(from);
        }
        expect(canTransition(from, to)).toBe(ok);
      });
    }
  }
});

describe("transitionCase side effects", () => {
  it("staff cannot decide a case still in AI_REVIEW", async () => {
    const f = new FakeModerationDb();
    const c = f.addCase(f.addReview().id as string, "AI_REVIEW");
    await expect(transitionCase(asDb(f), { caseId: c.id, to: "APPROVED", actor: staff })).rejects.toBeInstanceOf(IllegalTransitionError);
  });
  it("approve publishes the review and audits the actor", async () => {
    const f = new FakeModerationDb();
    const r = f.addReview({ status: "HIDDEN" });
    const c = f.addCase(r.id as string, "NEEDS_HUMAN");
    await transitionCase(asDb(f), { caseId: c.id, to: "APPROVED", actor: staff, reason: "ok" });
    expect(r.status).toBe("PUBLISHED");
    expect(r.publishedVersion).toBe(1);
    expect(f.revisions[0]!.status).toBe("APPROVED");
    expect(f.audit[0]).toMatchObject({ actorType: "STAFF", actorId: "admin1", action: "review.approve", entityId: r.id });
    expect(c as object).toMatchObject({ decidedById: "admin1" });
  });
  it("reject keeps the review unpublished and stores the reason", async () => {
    const f = new FakeModerationDb();
    const r = f.addReview({ status: "HIDDEN" });
    const c = f.addCase(r.id as string, "NEEDS_HUMAN");
    await transitionCase(asDb(f), { caseId: c.id, to: "REJECTED", actor: staff, reason: "spam" });
    expect(r.status).toBe("REJECTED");
    expect(r.publishedAt).toBeNull();
    expect((c as Record<string, unknown>).decisionReason).toBe("spam");
  });
  it("loses cleanly to a concurrent writer and rolls back", async () => {
    const f = new FakeModerationDb();
    const r = f.addReview({ status: "HIDDEN" });
    const c = f.addCase(r.id as string, "NEEDS_HUMAN");
    f.beforeCaseUpdate = () => { c.state = "REJECTED"; };
    await expect(transitionCase(asDb(f), { caseId: c.id, to: "APPROVED", actor: staff })).rejects.toBeInstanceOf(TransitionConflictError);
    expect(r.status).toBe("HIDDEN");
    expect(f.audit).toHaveLength(0);
  });
  it("a stale case version cannot change a newer review revision", async () => {
    const f = new FakeModerationDb();
    const r = f.addReview({ status: "PENDING", currentVersion: 2 });
    const c = f.addCase(r.id as string, "NEEDS_HUMAN", 1);
    await expect(transitionCase(asDb(f), { caseId: c.id, to: "APPROVED", actor: staff })).rejects.toBeInstanceOf(TransitionConflictError);
    expect(r.status).toBe("PENDING");
  });
});

describe("verdicts and providers", () => {
  const t = DEFAULT_THRESHOLDS;
  it("maps score/confidence to verdicts", () => {
    expect(decideVerdict({ score: 0.05, confidence: 0.9, reasons: [] }, t)).toBe("APPROVED");
    expect(decideVerdict({ score: 0.95, confidence: 0.9, reasons: [] }, t)).toBe("REJECTED");
    expect(decideVerdict({ score: 0.5, confidence: 0.9, reasons: [] }, t)).toBe("NEEDS_HUMAN");
    expect(decideVerdict({ score: 0.01, confidence: 0.3, reasons: [] }, t)).toBe("NEEDS_HUMAN"); // low confidence
    expect(decideVerdict({ score: NaN, confidence: 1, reasons: [] }, t)).toBe("NEEDS_HUMAN"); // malformed
  });
  it("mock provider is deterministic; factory rejects unknown providers", async () => {
    const m = new MockModerationProvider();
    expect((await m.assess({ title: "ok", body: "a perfectly normal review body", rating: 4 })).score).toBeLessThan(0.2);
    expect((await m.assess({ title: "scam", body: "total fraud", rating: 1 })).score).toBeGreaterThan(0.8);
    expect(createModerationProvider({}).name).toBe("mock");
    expect(() => createModerationProvider({ MODERATION_PROVIDER: "acme" })).toThrow();
  });
});

describe("verified buyer", () => {
  const mk = (verified = false) => {
    const set: string[] = [];
    const store = {
      findReview: async (id: string) => (id === "r1" ? { id, authorId: "u1", productId: "p1", verifiedBuyer: verified } : null),
      setVerified: async (id: string, order: string) => { set.push(`${id}:${order}`); },
    };
    return { store, set };
  };
  const lookup = new StubPurchaseLookup([{ orderId: "o1", userId: "u1", productId: "p1", purchasedAt: new Date() }]);
  it("marks verified when author bought the product", async () => {
    const { store, set } = mk();
    expect(await markVerifiedBuyer(store, lookup, "r1")).toBe(true);
    expect(set).toEqual(["r1:o1"]);
  });
  it("does not verify without a purchase, or for unknown reviews", async () => {
    const { store, set } = mk();
    expect(await markVerifiedBuyer(store, new StubPurchaseLookup(), "r1")).toBe(false);
    expect(await markVerifiedBuyer(store, lookup, "nope")).toBe(false);
    expect(set).toEqual([]);
  });
  it("is idempotent when already verified", async () => {
    const { store, set } = mk(true);
    expect(await markVerifiedBuyer(store, new StubPurchaseLookup(), "r1")).toBe(true);
    expect(set).toEqual([]);
  });
});
