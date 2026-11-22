import { describe, expect, it } from "vitest";
import {
  FakeModerationDb, PROOF_CONSENT_VERSION, REMOVAL_REASON_CODES, assertNoAutoVerify, authorizeVote, hashOrderRef, moderationJobSchema, normaliseOrderRef, orderRefCandidates,
  parseOrderRefKeys, proofEligibility, proofRetention, reportWeightFor, sanitizeAssessment, transitionCase, voteDelta, type ModerationDb,
} from "./index";

describe("VOT-001 authorizeVote matrix", () => {
  const base = { callerId: "u", emailVerified: true, votingRestricted: false, review: { authorId: "a", status: "PUBLISHED", sellerId: "S" }, callerSellerIds: [] as string[] };
  it.each([
    [{ review: { authorId: "u", status: "PUBLISHED", sellerId: "S" } }, "SELF_VOTE"],
    [{ callerSellerIds: ["S"] }, "CONFLICT_OF_INTEREST"],
    [{ votingRestricted: true }, "VOTING_RESTRICTED"],
    [{ emailVerified: false }, "EMAIL_NOT_VERIFIED"],
    [{ review: { authorId: "a", status: "REMOVED", sellerId: "S" } }, "NOT_FOUND"],
    [{ review: null }, "NOT_FOUND"],
  ])("%j -> %s", (over, deny) => expect(authorizeVote({ ...base, ...over })).toEqual({ ok: false, deny }));
  it("allows an ordinary voter", () => expect(authorizeVote(base)).toEqual({ ok: true }));
  it("voteDelta covers every transition", () => {
    expect(voteDelta(null, "HELPFUL")).toEqual({ h: 1, n: 0 });
    expect(voteDelta("HELPFUL", "NOT_HELPFUL")).toEqual({ h: -1, n: 1 });
    expect(voteDelta("NOT_HELPFUL", null)).toEqual({ h: 0, n: -1 });
    expect(voteDelta("HELPFUL", "HELPFUL")).toEqual({ h: 0, n: 0 });
  });
});

describe("PRV-021 proofAssessment strips unknown keys", () => {
  it("drops ocrText / name / address and invalid flags", () => {
    const a = sanitizeAssessment({ provider: "p", model: "m", promptVersion: "1", ocrText: "SECRET", name: "Jane", address: "1 Road", merchant: { name: "Shop", confidence: 0.9, address: "x" }, flags: ["DATE_IN_FUTURE", "BOGUS"] });
    expect(JSON.stringify(a)).not.toMatch(/SECRET|Jane|1 Road|BOGUS/);
    expect(a.flags).toEqual(["DATE_IN_FUTURE"]);
    expect(a.merchant).toEqual({ name: "Shop", confidence: 0.9 });
  });
});

describe("PRV-009/024 order reference hashing", () => {
  const keys = parseOrderRefKeys("2:bmV3,1:b2xk");
  it("normalises, uses the newest key id, and still finds hashes made with an older key", () => {
    expect(normaliseOrderRef(" 111-222 ab ")).toBe("111222AB");
    const h = hashOrderRef(keys[0]!, "amazon", "111-222");
    expect(h.keyId).toBe(2);
    expect(h.hash).toMatch(/^[0-9a-f]{64}$/);
    const old = hashOrderRef(keys[1]!, "amazon", "111-222").hash;
    expect(old).not.toBe(h.hash);
    expect(orderRefCandidates(keys, "amazon", "111-222")).toContain(old);
    expect(hashOrderRef(keys[0]!, "ebay", "111-222").hash).not.toBe(h.hash); // merchant is part of the HMAC input
  });
});

describe("proof rules", () => {
  const ok = { reviewStatus: "PUBLISHED", alreadyVerified: false, labelRevoked: false, openProof: false, rejectedCount: 0 };
  it("eligibility order and codes", () => {
    expect(proofEligibility(ok)).toBeNull();
    expect(proofEligibility({ ...ok, reviewStatus: "REMOVED" })).toEqual({ status: 404, code: "not_found" });
    expect(proofEligibility({ ...ok, alreadyVerified: true })?.code).toBe("already_verified");
    expect(proofEligibility({ ...ok, labelRevoked: true })?.code).toBe("label_revoked");
    expect(proofEligibility({ ...ok, openProof: true })?.code).toBe("proof_open_exists");
    expect(proofEligibility({ ...ok, rejectedCount: 3 })?.code).toBe("proof_attempts_exhausted");
    expect(PROOF_CONSENT_VERSION).toBe("2026-12");
  });
  it("PRV-016: PROOF_AUTO_VERIFY=true refuses to start", () => {
    expect(() => assertNoAutoVerify({ PROOF_AUTO_VERIFY: "true" })).toThrow();
    expect(() => assertNoAutoVerify({})).not.toThrow();
  });
  it("PRV-022: retention AT_DECISION vs APPEAL_WINDOW", () => {
    const d = new Date("2026-12-01T00:00:00Z");
    expect(proofRetention(d).originalPurgeAt).toEqual(d);
    expect(proofRetention(d, "APPEAL_WINDOW").originalPurgeAt).toEqual(new Date("2026-12-31T00:00:00Z"));
    expect(proofRetention(d).redactedPurgeAt).toEqual(new Date("2027-03-01T00:00:00Z"));
  });
});

describe("reports and jobs", () => {
  it("NEW reporters weigh 0; removal codes exclude OTHER", () => {
    expect(reportWeightFor(true)).toBe(0);
    expect(reportWeightFor(false)).toBe(1);
    expect(REMOVAL_REASON_CODES).not.toContain("OTHER");
    expect(REMOVAL_REASON_CODES).toContain("POLICY_OTHER");
  });
  it("moderation payload without trigger defaults to SUBMISSION (backward compatible)", () => {
    expect(moderationJobSchema.parse({ subjectType: "REVIEW", subjectId: "r", version: 1 }).trigger).toBe("SUBMISSION");
  });
});

describe("MOD-019 revision path (R2-R6)", () => {
  const asDb = (f: FakeModerationDb) => f as unknown as ModerationDb;
  const setup = () => {
    const f = new FakeModerationDb();
    const r = f.addReview({ status: "PUBLISHED", currentVersion: 2, publishedVersion: 1, rating: 5, title: "Old", body: "Old body of the review text." });
    f.revisions.length = 0;
    f.revisions.push({ reviewId: r.id, version: 1, status: "APPROVED" }, { reviewId: r.id, version: 2, status: "PENDING", rating: 2, title: "New", body: "New body of the review text.", incentive: "NONE" });
    const c = f.addCase(r.id as string, "AI_REVIEW", 2);
    c.trigger = "EDIT";
    return { f, r, c };
  };
  it("R2 approve copies the revision onto the row and bumps publishedVersion; review stays PUBLISHED", async () => {
    const { f, r, c } = setup();
    await transitionCase(asDb(f), { caseId: c.id, to: "APPROVED", actor: { type: "AI", provider: "t" } });
    expect(f.reviews[0]).toMatchObject({ status: "PUBLISHED", title: "New", rating: 2, publishedVersion: 2 });
    expect(f.revisions.find((x) => x.version === 2)!.status).toBe("APPROVED");
    expect(f.audit[0]).toMatchObject({ action: "review.revision_approve", entityId: r.id });
  });
  it("R3 reject and R4 hold leave the live text and status untouched", async () => {
    const a = setup();
    await transitionCase(asDb(a.f), { caseId: a.c.id, to: "REJECTED", actor: { type: "AI", provider: "t" } });
    expect(a.f.reviews[0]).toMatchObject({ status: "PUBLISHED", title: "Old", publishedVersion: 1 });
    expect(a.f.revisions.find((x) => x.version === 2)!.status).toBe("REJECTED");
    const b = setup();
    await transitionCase(asDb(b.f), { caseId: b.c.id, to: "NEEDS_HUMAN", actor: { type: "SYSTEM" } });
    expect(b.f.reviews[0]).toMatchObject({ status: "PUBLISHED", title: "Old" });
    expect(b.f.revisions.find((x) => x.version === 2)!.status).toBe("HELD");
    await transitionCase(asDb(b.f), { caseId: b.c.id, to: "APPROVED", actor: { type: "STAFF", id: "mod" } }); // R5
    expect(b.f.reviews[0]).toMatchObject({ title: "New", publishedVersion: 2 });
  });
  it("a stale decision after the review moved on is a conflict, not a write", async () => {
    const { f, c } = setup();
    f.reviews[0]!.currentVersion = 3; // the author edited again
    await expect(transitionCase(asDb(f), { caseId: c.id, to: "APPROVED", actor: { type: "AI", provider: "t" } })).rejects.toThrow();
    expect(f.reviews[0]!.title).toBe("Old");
  });
});

describe("SEC-M4-01 IP hash key has no default", () => {
  const good = "k".repeat(32);
  it("SEC-M4-01: hashIp refuses to run without a key (no public default) and is keyed otherwise", async () => {
    const { hashIp } = await import("./reports");
    const saved = process.env.IP_HASH_KEY;
    try {
      delete process.env.IP_HASH_KEY;
      expect(() => hashIp("1.2.3.4")).toThrow(/IP_HASH_KEY/);
      process.env.IP_HASH_KEY = "short";
      expect(() => hashIp("1.2.3.4")).toThrow(/IP_HASH_KEY/);
      process.env.IP_HASH_KEY = good;
      const a = hashIp("1.2.3.4");
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(hashIp("1.2.3.4", "j".repeat(32))).not.toBe(a);
      expect(hashIp("1.2.3.4", "dev-ip-hash-key")).not.toBe(hashIp("1.2.3.4", good)); // the old public default is not what is used
    } finally { if (saved === undefined) delete process.env.IP_HASH_KEY; else process.env.IP_HASH_KEY = saved; }
  });
  it("SEC-M4-01: the boot assertion throws without a key (never printing it), passes with one, and is skipped only under NODE_ENV=test", async () => {
    const { assertIpHashKey } = await import("./reports");
    expect(() => assertIpHashKey({ NODE_ENV: "production" })).toThrow(/IP_HASH_KEY must be set/);
    expect(() => assertIpHashKey({ NODE_ENV: "development", IP_HASH_KEY: "short-secret" })).toThrow(/IP_HASH_KEY/);
    try { assertIpHashKey({ NODE_ENV: "production", IP_HASH_KEY: "short-secret" }); } catch (e) { expect((e as Error).message).not.toContain("short-secret"); }
    expect(() => assertIpHashKey({ NODE_ENV: "production", IP_HASH_KEY: good })).not.toThrow();
    expect(() => assertIpHashKey({ NODE_ENV: "test" })).not.toThrow();
  });
  it("SEC-M4-01: the variable NAME (not a value) is documented in .env.example and wired at web and worker boot", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const root = resolve(__dirname, "../../..");
    expect(readFileSync(resolve(root, ".env.example"), "utf8")).toMatch(/^# IP_HASH_KEY=$/m);
    expect(readFileSync(resolve(root, "apps/web/src/instrumentation.ts"), "utf8")).toContain("assertIpHashKey");
    expect(readFileSync(resolve(root, "apps/worker/src/core-main.ts"), "utf8")).toContain("assertIpHashKey()");
    expect(readFileSync(resolve(root, "packages/core/src/reports.ts"), "utf8")).not.toContain("dev-ip-hash-key");
  });
});
