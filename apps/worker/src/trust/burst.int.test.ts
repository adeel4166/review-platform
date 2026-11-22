import { describe, expect, it } from "vitest";
import { CATEGORIES, aggregate, addMinutes, type BurstReview, type BurstState, type NearDuplicateIndex } from "@rp/core";
import { NearDuplicateIndex as Index } from "@rp/core";
import { FakeClock, MemoryStore, baseConfig } from "@rp/core/testing";
import { runAssess, type AssessJobDeps } from "../moderation/assess";
import { MemPorts } from "../moderation/test-ports";
import { applyBurst, routeReview, type BurstPort } from "./routing";
import { recomputeSubject, type TrustPort } from "./recompute";

const cfg = baseConfig();
const clean = { scores: Object.fromEntries(CATEGORIES.map((c) => [c, 0.005])) };

class MemBurst implements BurstPort {
  reviews: (BurstReview & { productId: string; status: string; excluded: boolean; rating: number })[] = [];
  bursts: (BurstState & { id: string; productId: string })[] = [];
  async recentReviews(productId: string, since: Date) { return this.reviews.filter((r) => r.productId === productId && r.createdAt > since); }
  async openBurst(productId: string, now: Date) { return this.bursts.find((b) => b.productId === productId && b.endsAt > now) ?? null; }
  async saveBurst(productId: string, s: BurstState, id?: string) {
    const ex = this.bursts.find((b) => b.id === id);
    if (ex) { Object.assign(ex, s); return { id: ex.id, opened: false }; }
    const n = { ...s, id: `b${this.bursts.length + 1}`, productId }; this.bursts.push(n); return { id: n.id, opened: true };
  }
}

describe("TRS-004 fake-review burst routing verified", () => {
  it("burst reviews end in lane HOLD (human) and none of the window's reviews counts in the aggregate until a human decision", async () => {
    const clock = new FakeClock();
    const store = new MemoryStore(clock);
    const ports = new MemPorts(store);
    const burst = new MemBurst();
    const idx = new Index();
    const reasons = new Set(["SPAM"]);
    const published: string[] = [];
    // 12 reviews from MEDIUM authors on one product within 12 minutes; clean text, clean AI.
    for (let i = 1; i <= 12; i++) {
      clock.advance(60_000);
      const id = `r${i}`;
      store.addTarget({ type: "REVIEW", id, status: "PENDING", version: 1, authorId: `a${i}`, trustBand: "MEDIUM" });
      const c = store.addCase({ id: `c${i}`, lane: null, openKey: `HOLD:R:${id}` });
      ports.track(c, { createdAt: clock.now(), targetId: id, media: "NONE", kind: "CONTENT" });
      burst.reviews.push({ id, createdAt: clock.now(), authorBand: "MEDIUM", productId: "p1", status: "PENDING", excluded: false, rating: 5 });
      const routing = await routeReview({ burst, dup: { index: idx as NearDuplicateIndex } }, clock, { productId: "p1", reviewId: id, authorId: `a${i}`, text: `review number ${i} ${"unique words ".repeat(3)}${i * 7919}` });
      ports.subjects.set(`c${i}`, { extraForceUnsure: routing.extraForceUnsure });
      const deps: AssessJobDeps = { store, port: ports, clock, config: cfg, reasonCodes: reasons, provider: { cfg, call: async () => clean } };
      const out = await runAssess(deps, `c${i}`, 1);
      if (out.status === "applied" && out.verdict === "CLEAN") published.push(id);
    }
    // reviews 1..10 auto-published; 11 and 12 tripped the burst and went to the human HOLD lane
    expect(published).toEqual(Array.from({ length: 10 }, (_, i) => `r${i + 1}`));
    for (const id of ["c11", "c12"]) expect(store.cases.get(id)).toMatchObject({ lane: "HOLD", status: "OPEN" });
    expect(store.decisions.filter((d) => d.caseId === "c11")[0]).toMatchObject({ reasonCode: "PRODUCT_BURST", source: "RULE" });
    expect(burst.bursts).toHaveLength(1);

    // trust.product-burst: exclude the window's published reviews from the aggregate and bump post-review priority
    const bumped: string[] = [];
    const ids = await applyBurst({
      excludePublishedInWindow: async (_p, _f, _t, at) => { const r = burst.reviews.filter((x) => published.includes(x.id)); r.forEach((x) => (x.excluded = true)); return r.map((x) => x.id).filter(() => !!at); },
      bumpPostReview: async (x) => { bumped.push(...x); },
    }, clock, "p1", burst.bursts[0]!);
    expect(ids).toHaveLength(10); expect(bumped).toHaveLength(10);
    const agg = aggregate(burst.reviews.map((r) => ({ rating: r.rating, status: published.includes(r.id) ? "PUBLISHED" : "PENDING", verifiedPurchaseAt: null, aggregateExcludedAt: r.excluded ? clock.now() : null })));
    expect(agg.ratingCount).toBe(0);
    expect(addMinutes(clock.now(), 0)).toBeDefined();
  });

  it("a near-duplicate of another author's review is forced UNSURE", async () => {
    const clock = new FakeClock(), burst = new MemBurst(), idx = new Index();
    const text = "this blender crushes ice quickly and the jar feels sturdy but the lid leaks a little when hot soup is blended so I would recommend it";
    await routeReview({ burst, dup: { index: idx } }, clock, { productId: "p1", reviewId: "x1", authorId: "a1", text });
    const r = await routeReview({ burst, dup: { index: idx } }, clock, { productId: "p2", reviewId: "x2", authorId: "a2", text: text + " really" });
    expect(r.extraForceUnsure).toEqual(["NEAR_DUPLICATE"]); expect(r.nearDuplicateOf).toEqual(["x1"]);
  });
});

describe("trust.recompute", () => {
  it("snapshots only when the score or band changed and re-weights votes on a band change", async () => {
    const clock = new FakeClock();
    const saved: { snapshot: boolean }[] = []; let prev = { band: "NEW" as const, score: null as number | null }; let rew = 0;
    const port: TrustPort = {
      userInputs: async () => ({ createdAt: new Date("2026-01-01"), emailVerified: true, twoFactor: true, activeRestriction: false, qualifyingActions: 9, signals: [], previousBand: prev.band, previousScore: prev.score }),
      sellerInputs: async () => null,
      saveUser: async (_id, r, _at, snapshot) => { saved.push({ snapshot }); prev = { band: r.band as "NEW", score: r.score }; },
      saveSeller: async () => {},
      reweightVotes: async () => ++rew,
    };
    const a = await recomputeSubject(port, clock, "U:u1");
    expect(a).toMatchObject({ changed: true, reweighted: 1 });
    const b = await recomputeSubject(port, clock, "U:u1");
    expect(b).toMatchObject({ changed: false, reweighted: 0 });
    expect(saved.map((s) => s.snapshot)).toEqual([true, false]);
  });
});
