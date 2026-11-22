import { describe, expect, it } from "vitest";
import { FakeClock } from "../testing/fake-clock";
import { scoreUser, scoreSeller, roundHalfEven, publicExplanation, type UserInputs } from "./score";
import { countVotes, detectVoteAnomaly, maturityGates, reweight, voteWeight } from "./votes";
import { NearDuplicateIndex, estimateJaccard, minhash } from "./minhash";
import { detectProductBurst } from "./burst";
import { MemorySignalStore, recordSignals, signalsFor, type TrustEvent } from "./signals";
import { aggregate } from "../catalog/aggregate";

const clock = new FakeClock("2027-03-01T09:00:00.000Z");
const daysAgo = (n: number) => new Date(clock.now().getTime() - n * 86_400_000);
const user = (o: Partial<UserInputs> = {}): UserInputs => ({ createdAt: daysAgo(200), emailVerified: true, twoFactor: false, activeRestriction: false, qualifyingActions: 5, signals: [], ...o });

describe("TRS-001 vote maturity and weights", () => {
  it("a NEW voter's vote has weight 0 and is not counted until all three gates pass; then votes of the last 30 days are re-weighted", () => {
    expect(voteWeight("NEW")).toBe(0);
    const now = clock.now();
    expect(maturityGates({ createdAt: daysAgo(3), emailVerified: true, qualifyingActions: 5 }, now).mature).toBe(false); // age
    expect(maturityGates({ createdAt: daysAgo(30), emailVerified: false, qualifyingActions: 5 }, now).mature).toBe(false); // email
    expect(maturityGates({ createdAt: daysAgo(30), emailVerified: true, qualifyingActions: 2 }, now).mature).toBe(false); // actions
    expect(maturityGates({ createdAt: daysAgo(30), emailVerified: true, qualifyingActions: 3 }, now).mature).toBe(true);
    // score engine agrees: any failed gate -> NEW
    expect(scoreUser(user({ createdAt: daysAgo(3) }), clock).band).toBe("NEW");
    expect(scoreUser(user({ emailVerified: false }), clock).band).toBe("NEW");
    expect(scoreUser(user({ qualifyingActions: 2 }), clock).band).toBe("NEW");
    expect(scoreUser(user(), clock).band).not.toBe("NEW");

    const votes = [{ value: "HELPFUL" as const, weight: 0, frozen: false, createdAt: daysAgo(5) }, { value: "HELPFUL" as const, weight: 0, frozen: false, createdAt: daysAgo(45) }];
    expect(countVotes(votes)).toEqual({ helpfulCount: 0, notHelpfulCount: 0, helpfulWeighted: 0 });
    const after = reweight(votes, "MEDIUM", now);
    expect(after.map((v) => v.weight)).toEqual([1, 0]); // only the last 30 days
    expect(countVotes(after)).toEqual({ helpfulCount: 1, notHelpfulCount: 0, helpfulWeighted: 1 });
    expect(voteWeight("LOW")).toBe(0.5); expect(voteWeight("HIGH")).toBe(1.5);
  });
  it("frozen votes are stored but not counted", () => {
    expect(countVotes([{ value: "HELPFUL", weight: 1, frozen: true }, { value: "NOT_HELPFUL", weight: 1, frozen: false }])).toMatchObject({ helpfulCount: 0, notHelpfulCount: 1, helpfulWeighted: -1 });
  });
});

describe("TRS-002 velocity triggers", () => {
  it("fires on >20 votes/hour, low-trust share and shared IP; quiet otherwise", () => {
    const now = clock.now();
    const mk = (n: number, band: "NEW" | "HIGH" = "HIGH", ip?: (i: number) => string) => Array.from({ length: n }, (_, i) => ({ at: new Date(now.getTime() - i * 1000), band, ipHash: ip?.(i) ?? `ip${i}` }));
    expect(detectVoteAnomaly(mk(21), now)).toBe("VOTES_PER_HOUR");
    expect(detectVoteAnomaly(mk(12, "NEW"), now)).toBe("LOW_TRUST_SHARE");
    expect(detectVoteAnomaly(mk(3, "HIGH", () => "same"), now)).toBe("SHARED_IP");
    expect(detectVoteAnomaly(mk(5), now)).toBeNull();
  });
});

const BASE_WORDS = "this blender crushes ice quickly and the jar feels sturdy but the lid leaks a little when hot soup is blended so I would recommend it for smoothies only and the motor is quiet compared with my old one although cleaning takes a while because the blades are fixed and the cord is short which is annoying on my counter overall good value for the price".split(" ");
describe("TRS-003 near-duplicate detection (MinHash + LSH)", () => {
  it("flags 20 copies/light paraphrases across 5 accounts and none of 20 unrelated reviews", () => {
    const idx = new NearDuplicateIndex();
    const prints: { id: string; author: string; sig: Uint32Array; dup: boolean }[] = [];
    for (let i = 0; i < 20; i++) {
      const w = [...BASE_WORDS];
      if (i % 2) { w[3 + (i % 5)] = `x${i}`; w[20 + (i % 7)] = `y${i}`; } // light paraphrase
      prints.push({ id: `d${i}`, author: `a${i % 5}`, sig: minhash(w.join(" ")), dup: true });
    }
    for (let i = 0; i < 20; i++) {
      const w = Array.from({ length: 55 }, (_, j) => `u${i}_${(j * 7 + i * 13) % 97}_${j}`);
      prints.push({ id: `n${i}`, author: `b${i}`, sig: minhash(["great", "product", ...w].join(" ")), dup: false });
    }
    for (const p of prints) idx.add({ reviewId: p.id, authorId: p.author, sig: p.sig });
    for (const p of prints) {
      const hits = idx.query({ reviewId: p.id, authorId: p.author, sig: p.sig });
      expect(hits.length > 0, p.id).toBe(p.dup);
    }
    expect(estimateJaccard(prints[0]!.sig, prints[0]!.sig)).toBe(1);
  });
  it("same-author repeats are not flagged", () => {
    const idx = new NearDuplicateIndex(), sig = minhash(BASE_WORDS.join(" "));
    idx.add({ reviewId: "1", authorId: "a", sig });
    expect(idx.query({ reviewId: "2", authorId: "a", sig })).toEqual([]);
  });
});

describe("TRS-004 burst detection", () => {
  const at = (m: number) => new Date(clock.now().getTime() - m * 60_000);
  const rv = (n: number, band: "MEDIUM" | "NEW" = "MEDIUM") => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, createdAt: at(i), authorBand: band }));
  it("above 10/hour or 5 low-trust/hour -> burst + PRODUCT_BURST; endsAt = last + 60 min", () => {
    expect(detectProductBurst(rv(10), clock.now(), null).burst).toBe(false);
    const v = detectProductBurst(rv(11), clock.now(), null);
    expect(v).toMatchObject({ burst: true, forceUnsure: "PRODUCT_BURST" });
    expect(v.state!.endsAt.getTime()).toBe(v.state!.lastReviewAt.getTime() + 3_600_000);
    expect(detectProductBurst(rv(6, "NEW"), clock.now(), null).burst).toBe(true);
    expect(detectProductBurst(rv(5, "NEW"), clock.now(), null).burst).toBe(false);
  });
  it("an open burst keeps routing until it ends", () => {
    const open = { startedAt: at(30), lastReviewAt: at(1), endsAt: new Date(clock.now().getTime() + 59 * 60_000), reviewCount: 11, lowTrustCount: 0 };
    expect(detectProductBurst(rv(1), clock.now(), open).burst).toBe(true);
  });
});

describe("TRS-005 score determinism, caps and decay", () => {
  it("is deterministic, bounded 0..100 and rounds half-even", () => {
    const sig = [{ type: "VERIFIED_PURCHASE", value: 1, occurredAt: daysAgo(10) }, { type: "REVIEW_PUBLISHED", value: 1, occurredAt: daysAgo(400) }];
    const a = scoreUser(user({ signals: sig }), clock), b = scoreUser(user({ signals: [...sig].reverse() }), clock);
    expect(a).toEqual(b);
    expect(roundHalfEven(0.125)).toBe(0.12); expect(roundHalfEven(0.135)).toBe(0.14);
    const bad = scoreUser(user({ signals: Array.from({ length: 20 }, (_, i) => ({ type: "CONTENT_ACTIONED_AGAINST", value: 1, occurredAt: daysAgo(i) })) }), clock);
    expect(bad.score).toBeGreaterThanOrEqual(0);
    expect(bad.components.CONTENT_ACTIONED_AGAINST!.contribution).toBe(-40);
    expect(bad.caps).toContain("RECENT_NEGATIVE");
  });
  it("voided signals do not count; restriction caps at LOW; sellers have no NEW gate", () => {
    const s = [{ type: "CONTENT_ACTIONED_AGAINST", value: 1, occurredAt: daysAgo(1), voidedAt: daysAgo(0) }];
    expect(scoreUser(user({ signals: s }), clock).caps).toEqual([]);
    expect(scoreUser(user({ activeRestriction: true, signals: Array.from({ length: 10 }, () => ({ type: "VERIFIED_PURCHASE", value: 1, occurredAt: daysAgo(1) })) }), clock).band).toBe("LOW");
    const sl = scoreSeller({ verified: true, verifiedClaimAt: daysAgo(400), replyRate: 1, verifiedShare: 1, suspended: false, replyRestricted: false, signals: [] }, clock);
    expect(sl.band).toBe("HIGH");
    expect(publicExplanation(sl)).not.toHaveProperty("score");
  });
});

describe("TRS-008 trust signals are written exactly once", () => {
  const events: TrustEvent[] = [
    { kind: "transition", transition: "T2", target: "Review", targetId: "r1", authorId: "u1" },
    { kind: "transition", transition: "T9", target: "Review", targetId: "r1", authorId: "u1", decisionId: "d1" },
    { kind: "transition", transition: "T9", target: "SellerReply", targetId: "sr1", sellerId: "s1", decisionId: "d2" },
    { kind: "transition", transition: "T2", target: "SellerReply", targetId: "sr1", sellerId: "s1" },
    { kind: "media.rejected", reason: "MALWARE", assetId: "m1", uploaderId: "u1" },
    { kind: "enforcement.issued", enforcementId: "e1", subjectUserId: "u1", type: "SUSPENSION" },
    { kind: "appeal.overturned", appealId: "ap1", appellantId: "u1", overturnedDecisionId: "d1", overturnedAuthorId: "u1" },
    { kind: "report.resolved", reportId: "rp1", reporterId: "u2", outcome: "UPHELD" },
    { kind: "report.resolved", reportId: "rp2", reporterId: "u2", outcome: "ABUSIVE" },
    { kind: "proof.decided", proofId: "p1", submitterId: "u1", outcome: "VERIFIED" },
    { kind: "votes.daily", yyyymmdd: "20270228", authorId: "u1", weightedNet: 3.5 },
    { kind: "detector", runId: "run1", type: "NEAR_DUPLICATE_TEXT", userId: "u1" },
  ];
  it("maps each event row to its signal and a duplicate event yields one row", async () => {
    const store = new MemorySignalStore();
    for (const e of events) { await recordSignals(store, clock, e); await recordSignals(store, clock, e); }
    const types = store.rows.map((r) => `${r.type}:${r.subjectKey}`).sort();
    expect(types).toEqual([
      "APPEAL_OVERTURNED:U:u1", "CONTENT_ACTIONED_AGAINST:U:u1", "ENFORCEMENT_ACTION:U:u1", "HELPFUL_VOTE_RECEIVED:U:u1", "MALWARE_UPLOAD:U:u1",
      "NEAR_DUPLICATE_TEXT:U:u1", "REPORT_REJECTED:U:u2", "REPORT_UPHELD:U:u2", "REVIEW_PUBLISHED:U:u1", "SELLER_REPLY_PUBLISHED:S:s1", "SELLER_REPLY_REMOVED:S:s1", "VERIFIED_PURCHASE:U:u1",
    ].sort());
    expect(store.rows.find((r) => r.type === "ENFORCEMENT_ACTION")!.value).toBe(-30);
    // the overturn voided the signal of the overturned decision
    expect(store.rows.find((r) => r.type === "CONTENT_ACTIONED_AGAINST")!.voidedAt).toBeDefined();
  });
  it("writes nothing for hold expiry, post-review lapse, author delete or a reversible hide", () => {
    for (const t of ["T7", "R7", "T10", "T13", "T19", "T15"]) expect(signalsFor({ kind: "transition", transition: t, target: "Review", targetId: "r", authorId: "u", decisionId: "d" })).toEqual([]);
  });
  it("same source twice for DIFFERENT subjects is allowed (key includes the subject)", async () => {
    const store = new MemorySignalStore();
    expect(await store.insertIfAbsent({ type: "REPORT_UPHELD", sourceType: "Report", sourceId: "x", subjectKey: "U:a", userId: "a", sellerId: null, value: 1, occurredAt: clock.now() })).toBe(true);
    expect(await store.insertIfAbsent({ type: "REPORT_UPHELD", sourceType: "Report", sourceId: "x", subjectKey: "U:b", userId: "b", sellerId: null, value: 1, occurredAt: clock.now() })).toBe(true);
  });
});

describe("TRS-007 aggregates", () => {
  it("only PUBLISHED and non-excluded count; independent of order", () => {
    const rows = [
      { rating: 5, status: "PUBLISHED", verifiedPurchaseAt: clock.now(), aggregateExcludedAt: null }, { rating: 3, status: "PUBLISHED", verifiedPurchaseAt: null, aggregateExcludedAt: null },
      { rating: 1, status: "HIDDEN", verifiedPurchaseAt: null, aggregateExcludedAt: null }, { rating: 1, status: "PUBLISHED", verifiedPurchaseAt: null, aggregateExcludedAt: clock.now() },
      { rating: 4, status: "PENDING", verifiedPurchaseAt: null, aggregateExcludedAt: null },
    ];
    const a = aggregate(rows);
    expect(a).toMatchObject({ ratingAverage: 4, ratingCount: 2, verifiedRatingAverage: 5, verifiedRatingCount: 1 });
    expect(aggregate([...rows].reverse())).toEqual(a);
  });
});
