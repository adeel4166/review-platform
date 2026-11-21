import { describe, expect, it } from "vitest";
import { CLAIM_CONFIG, DAY_MS, createFakeClaimDb } from "@rp/core";
import { extractMetaTokens } from "./meta";
import { observeDns, observeMeta, processClaimCheck, prepareClaimCheck, applyClaimObservation, runEgressCheck, sweepDueChecks, sweepExpiry, sweepGrace, type CheckDeps, type CheckStore } from "./checks";
import { sendClaimNotice } from "./notify";
import { FakeMailProvider } from "@rp/core";

const T0 = new Date("2026-12-01T00:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("meta parser", () => {
  it("finds the tag in the head, case-insensitively, with any quoting", () => {
    expect(extractMetaTokens(`<html><head><META NAME='RP-Verify' content=abc123></head><body></body></html>`)).toEqual(["abc123"]);
    expect(extractMetaTokens(`<head><meta content="x y" name="rp-verify"/></head>`)).toEqual(["x y"]);
  });
  it("ignores comments, scripts, body content and other names", () => {
    expect(extractMetaTokens(`<head><!-- <meta name="rp-verify" content="c"> --><script>var a='<meta name="rp-verify" content="s">'</script><meta name="description" content="d"></head><body><meta name="rp-verify" content="b"></body>`)).toEqual([]);
    expect(extractMetaTokens(`<head><title><meta name="rp-verify" content="t"></title></head>`)).toEqual([]);
  });
  it("caps the number and length of observed tokens", () => {
    const many = Array.from({ length: 20 }, (_, i) => `<meta name="rp-verify" content="${i}">`).join("");
    expect(extractMetaTokens(`<head>${many}</head>`)).toHaveLength(5);
    expect(extractMetaTokens(`<head><meta name="rp-verify" content="${"a".repeat(500)}"></head>`)[0]).toHaveLength(128);
  });
});

const dnsDeps = (records: string[][] | Error, fetcher?: CheckDeps["fetcher"]): CheckDeps => ({
  dns: { resolveTxt: async () => { if (records instanceof Error) throw records; return records; } },
  fetcher: fetcher ?? { fetch: async () => ({ ok: false, error: "FETCH_ERROR", hop: 0 }) },
});

describe("observers", () => {
  it("DNS: joins TXT chunks, keeps only rp-verify records, maps NXDOMAIN to nothing observed", async () => {
    expect(await observeDns(dnsDeps([["rp-verify=ab", "cd"], ["v=spf1 -all"]]), "acme.com")).toEqual({ observed: ["abcd"], error: null });
    expect(await observeDns(dnsDeps(Object.assign(new Error("x"), { code: "ENOTFOUND" })), "acme.com")).toEqual({ observed: [], error: null });
    expect(await observeDns(dnsDeps(Object.assign(new Error("x"), { code: "ESERVFAIL" })), "acme.com")).toEqual({ observed: [], error: "DNS_ERROR" });
  });
  it("META: fetches only the apex (T-03, no www fallback), requires the final URL inside the domain, records the proof host, maps blocked fetches", async () => {
    const urls: string[] = [];
    const d = dnsDeps([], { fetch: async (u, o) => { urls.push(`${u}|${o?.finalMustBeInside}`); return u.includes("www.") ? { ok: true, finalUrl: u, status: 200, body: Buffer.from('<head><meta name="rp-verify" content="tok"></head>'), hops: 0, pinnedIps: ["1.1.1.1"] } : { ok: false, error: "BLOCKED_IP", hop: 0 }; } });
    // token only on www: nothing observed, never fetched
    expect(await observeMeta(d, "acme.com")).toEqual({ observed: [], error: "FETCH_BLOCKED" });
    expect(urls).toEqual(["https://acme.com/|acme.com"]);
    const apex = dnsDeps([], { fetch: async (u) => ({ ok: true, finalUrl: u, status: 200, body: Buffer.from('<head><meta name="rp-verify" content="tok"></head>'), hops: 0, pinnedIps: ["1.1.1.1"] }) });
    expect(await observeMeta(apex, "acme.com")).toEqual({ observed: ["tok"], error: null, proofHost: "acme.com" });
    const blocked = dnsDeps([], { fetch: async () => ({ ok: false, error: "BLOCKED_IP", hop: 0 }) });
    expect(await observeMeta(blocked, "acme.com")).toEqual({ observed: [], error: "FETCH_BLOCKED" });
  });
});

function setup(claimOver: Record<string, unknown> = {}) {
  const db = createFakeClaimDb({
    user: [{ id: "u1", status: "ACTIVE", emailVerifiedAt: T0 }],
    seller: [{ id: "A", status: "PENDING_VERIFICATION", closedAt: null }],
    sellerMember: [{ sellerId: "A", userId: "u1", role: "OWNER" }],
    sellerOwnershipClaim: [{
      id: "c1", sellerId: "A", scope: "SELLER", method: "DNS_TXT", status: "PENDING", domain: "acme.com", challengeValue: "tok", challengeExpiresAt: at(72 * 3600_000),
      requiresHumanReview: false, requiredApprovals: 1, checkAttempts: 0, activeKey: "k", submittedById: "u1", nextCheckAt: T0, ...claimOver,
    }],
  });
  return db;
}

describe("verification.check processor", () => {
  it("PENDING + matching token -> VERIFIED", async () => {
    const db = setup();
    const out = await processClaimCheck(db as unknown as CheckStore, dnsDeps([["rp-verify=tok"]]), "c1", T0);
    expect(out).toBe("PASS:VERIFIED");
    expect(db.t.seller![0]!.status).toBe("VERIFIED");
  });
  it("PENDING + missing token backs off and stays PENDING; an egress error never ends the claim", async () => {
    const db = setup();
    expect(await processClaimCheck(db as unknown as CheckStore, dnsDeps([]), "c1", T0)).toBe("NOT_FOUND");
    expect(db.t.sellerOwnershipClaim![0]).toMatchObject({ status: "PENDING", checkAttempts: 1, lastCheckOutcome: "NOT_FOUND" });
    expect(db.t.sellerOwnershipClaim![0]!.nextCheckAt).toEqual(at(5 * 60_000));
    expect(await processClaimCheck(db as unknown as CheckStore, dnsDeps(new Error("boom")), "c1", at(10 * 60_000))).toBe("DNS_ERROR");
    expect(db.t.sellerOwnershipClaim![0]!.status).toBe("PENDING");
  });
  it("another claim's token on the same domain does not verify this claim", async () => {
    const db = setup();
    expect(await processClaimCheck(db as unknown as CheckStore, dnsDeps([["rp-verify=someone-elses"]]), "c1", T0)).toBe("MISMATCH");
    expect(db.t.sellerOwnershipClaim![0]!.status).toBe("PENDING");
  });
  it("an expired challenge cannot pass", async () => {
    const db = setup();
    expect(await processClaimCheck(db as unknown as CheckStore, dnsDeps([["rp-verify=tok"]]), "c1", at(73 * 3600_000))).toBe("NOT_FOUND");
    expect(db.t.sellerOwnershipClaim![0]!.status).toBe("PENDING");
  });
  it("DOCUMENT claims are never checked by the worker", async () => {
    const db = setup({ method: "DOCUMENT", domain: null });
    expect(await processClaimCheck(db as unknown as CheckStore, dnsDeps([]), "c1", T0)).toBe("SKIPPED");
  });
});

describe("monthly re-verification, grace and downgrade with a fake clock (SEL-008)", () => {
  const verified = () => setup({ status: "VERIFIED", verifiedAt: T0, verifiedUntil: at(CLAIM_CONFIG.validityMs), verifiedDomainKey: "acme.com", lastCheckAt: T0, lastCheckOutcome: "PASS", nextCheckAt: null });
  const q = () => { const jobs: Array<{ name: string; id: string }> = []; return { jobs, add: async (name: string, _d: unknown, o: { jobId: string }) => { jobs.push({ name, id: o.jobId }); } }; };
  it("is not scheduled before 30 days, is scheduled after, and runs daily during grace", async () => {
    const db = verified();
    const early = q();
    expect(await sweepDueChecks(db as unknown as CheckStore, early, at(29 * DAY_MS))).toBe(0);
    const due = q();
    expect(await sweepDueChecks(db as unknown as CheckStore, due, at(31 * DAY_MS))).toBe(1);
    expect(due.jobs[0]!.id).toMatch(/^claimreverify__c1__/);
  });
  it("day 31 record gone -> grace; badge stays for 14 days; day 46 still failing -> EXPIRED and the seller is downgraded", async () => {
    const db = verified();
    db.t.seller![0]!.status = "VERIFIED";
    const store = db as unknown as CheckStore;
    expect(await processClaimCheck(store, dnsDeps([]), "c1", at(31 * DAY_MS))).toBe("ENTER_GRACE:NOT_FOUND");
    expect(db.t.sellerOwnershipClaim![0]).toMatchObject({ status: "VERIFIED", graceEndsAt: at(45 * DAY_MS) });
    expect(db.t.seller![0]!.status).toBe("VERIFIED");
    expect(await sweepGrace(store, at(44 * DAY_MS))).toEqual({ graceStarted: 0, expired: 0 });
    expect(await processClaimCheck(store, dnsDeps([]), "c1", at(46 * DAY_MS))).toBe("EXPIRE_GRACE:NOT_FOUND");
    expect(db.t.sellerOwnershipClaim![0]).toMatchObject({ status: "EXPIRED", endReason: "REVERIFY_FAILED" });
    expect(db.t.seller![0]).toMatchObject({ status: "UNVERIFIED", verifiedClaimId: null });
    expect(db.t.outboxEvent!.map((o) => o.type)).toEqual(expect.arrayContaining(["claim.grace_started", "claim.expired", "seller.downgraded"]));
  });
  it("sweepGrace expires a lapsed grace by itself, and the record coming back inside the grace saves the claim", async () => {
    const lapsed = verified();
    const s1 = lapsed as unknown as CheckStore;
    await processClaimCheck(s1, dnsDeps([]), "c1", at(31 * DAY_MS));
    expect(await sweepGrace(s1, at(46 * DAY_MS))).toEqual({ graceStarted: 0, expired: 1 });
    const saved = verified();
    const s2 = saved as unknown as CheckStore;
    await processClaimCheck(s2, dnsDeps([]), "c1", at(31 * DAY_MS));
    expect(await processClaimCheck(s2, dnsDeps([["rp-verify=tok"]]), "c1", at(40 * DAY_MS))).toBe("RENEW:PASS");
    expect(saved.t.sellerOwnershipClaim![0]).toMatchObject({ status: "VERIFIED", graceEndsAt: null });
    expect(await sweepGrace(s2, at(60 * DAY_MS))).toEqual({ graceStarted: 0, expired: 0 });
  });
  it("EMAIL/DOCUMENT claims enter grace when verifiedUntil passes and expire VALIDITY_ENDED after it", async () => {
    const db = setup({ method: "DOCUMENT", domain: null, status: "VERIFIED", verifiedAt: T0, verifiedUntil: at(10 * DAY_MS), verifiedDomainKey: null, requiresHumanReview: true });
    const s = db as unknown as CheckStore;
    expect(await sweepGrace(s, at(11 * DAY_MS))).toEqual({ graceStarted: 1, expired: 0 });
    expect(await sweepGrace(s, at(26 * DAY_MS))).toEqual({ graceStarted: 0, expired: 1 });
    expect(db.t.sellerOwnershipClaim![0]).toMatchObject({ status: "EXPIRED", endReason: "VALIDITY_ENDED" });
  });
  it("sweepExpiry ends an unverified challenge after 72 h and leaves 'evidence passed' claims alone", async () => {
    const db = setup();
    expect(await sweepExpiry(db as unknown as CheckStore, at(71 * 3600_000))).toBe(0);
    expect(await sweepExpiry(db as unknown as CheckStore, at(73 * 3600_000))).toBe(1);
    expect(db.t.sellerOwnershipClaim![0]).toMatchObject({ status: "EXPIRED", endReason: "CHALLENGE_TIMEOUT", activeKey: null });
    const passed = setup({ lastCheckOutcome: "PASS", requiresHumanReview: true });
    expect(await sweepExpiry(passed as unknown as CheckStore, at(73 * 3600_000))).toBe(0);
  });
});

describe("claim notifications (SEL-005)", () => {
  it("claim.contested mails the incumbent's OWNERs and the claimant, with no evidence or addresses in the body", async () => {
    const claims = [{ id: "c1", sellerId: "A", conflictClaimId: "inc" }, { id: "inc", sellerId: "B", conflictClaimId: null }];
    const members = [{ sellerId: "A", userId: "ua", role: "OWNER" }, { sellerId: "B", userId: "ub", role: "OWNER" }, { sellerId: "B", userId: "ur", role: "RESPONDER" }];
    const users = [{ id: "ua", email: "a@a.test" }, { id: "ub", email: "b@b.test" }, { id: "ur", email: "r@b.test" }];
    const mail = new FakeMailProvider();
    const db = {
      sellerOwnershipClaim: { findUnique: async ({ where }: { where: { id: string } }) => claims.find((c) => c.id === where.id) ?? null },
      sellerMember: { findMany: async ({ where }: { where: { sellerId: string; role: { in: string[] } } }) => members.filter((m) => m.sellerId === where.sellerId && where.role.in.includes(m.role)) },
      user: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => users.filter((u) => where.id.in.includes(u.id)) },
    };
    expect(await sendClaimNotice({ db, mail, baseUrl: "https://rp.test" }, "claim.contested", "c1", "job1")).toBe("SENT");
    expect(mail.sent.map((m) => m.to).sort()).toEqual(["a@a.test", "b@b.test"]);
    expect(mail.sent.every((m) => !/acme|tok/.test(m.text))).toBe(true);
    expect(await sendClaimNotice({ db, mail }, "claim.unknown", "c1", "job2")).toBe("SKIPPED");
  });
});

describe("META_TAG www-only token does not approve (T-03)", () => {
  it("a claim whose token is served only on www stays PENDING", async () => {
    const db = createFakeClaimDb({
      user: [{ id: "u1", status: "ACTIVE", emailVerifiedAt: T0 }], seller: [{ id: "A", status: "PENDING_VERIFICATION", closedAt: null }],
      sellerMember: [{ sellerId: "A", userId: "u1", role: "OWNER" }],
      sellerOwnershipClaim: [{ id: "c1", sellerId: "A", scope: "SELLER", method: "META_TAG", status: "PENDING", domain: "acme.com", challengeValue: "tok", challengeExpiresAt: at(72 * 3600_000), requiresHumanReview: false, requiredApprovals: 1, checkAttempts: 0, activeKey: "k", submittedById: "u1", nextCheckAt: T0 }],
    });
    const d: CheckDeps = {
      dns: { resolveTxt: async () => [] },
      fetcher: { fetch: async (u) => (u.includes("//www.") ? { ok: true, finalUrl: u, status: 200, body: Buffer.from('<head><meta name="rp-verify" content="tok"></head>'), hops: 0, pinnedIps: ["1.1.1.1"] } : { ok: false, error: "FETCH_ERROR", hop: 0 }) },
    };
    await processClaimCheck(db as unknown as CheckStore, d, "c1", at(1000));
    expect(db.t.sellerOwnershipClaim![0]!.status).toBe("PENDING");
  });
});

describe("T-01 split pipeline (core -> egress -> core)", () => {
  it("egress rejects malformed requests without touching the network", async () => {
    let called = false;
    const d: CheckDeps = { dns: { resolveTxt: async () => { called = true; return []; } }, fetcher: { fetch: async () => { called = true; return { ok: false, error: "FETCH_ERROR", hop: 0 }; } } };
    const r = await runEgressCheck(d, { claimId: "c1", method: "META_TAG", domain: "http://169.254.169.254/x" });
    expect(r.error).toBe("FETCH_BLOCKED");
    expect(called).toBe(false);
  });
  it("prepare returns null for unknown claims; egress result round-trips through JSON", async () => {
    const db = { sellerOwnershipClaim: { findUnique: async () => null, findMany: async () => [] } } as unknown as CheckStore;
    expect(await prepareClaimCheck(db, "nope")).toBeNull();
    expect(await applyClaimObservation(db, "nope", { observed: [], error: null })).toBe("SKIPPED");
    const d: CheckDeps = { dns: { resolveTxt: async () => [["rp-verify=abc"]] }, fetcher: { fetch: async () => ({ ok: false, error: "FETCH_ERROR", hop: 0 }) } };
    const r = JSON.parse(JSON.stringify(await runEgressCheck(d, { claimId: "c1", method: "DNS_TXT", domain: "example.com" })));
    expect(r.claimId).toBe("c1");
    expect(r.error).toBeNull();
  });
});
