import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFakeClaimDb } from "@rp/core";
import { applyClaimObservation, observeMx, prepareClaimCheck, processClaimCheck, runEgressCheck, sweepDueChecks, sweepExpiry, type CheckDeps, type CheckStore } from "./checks";
import { routes } from "../outbox";
import { assertEgressEnv } from "../groups";

const T0 = new Date("2026-12-01T00:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

const world = () =>
  createFakeClaimDb({
    user: [{ id: "u1", status: "ACTIVE", emailVerifiedAt: T0 }],
    seller: [{ id: "A", status: "PENDING_VERIFICATION", closedAt: null }],
    sellerMember: [{ sellerId: "A", userId: "u1", role: "OWNER" }],
    emailVerificationToken: [{ id: "tok1", claimId: "c1", purpose: "CLAIM_BUSINESS_EMAIL", userId: "u1", email: "jane@acme.com", sentAt: null, consumedAt: null, invalidatedAt: null }],
    sellerOwnershipClaim: [{
      id: "c1", sellerId: "A", scope: "SELLER", method: "BUSINESS_EMAIL_DOMAIN", status: "PENDING", domain: "acme.com", businessEmail: "jane@acme.com", challengeValue: null,
      challengeExpiresAt: at(72 * 3_600_000), requiresHumanReview: false, requiredApprovals: 1, checkAttempts: 0, activeKey: "k", submittedById: "u1", nextCheckAt: T0,
    }],
  });
const mxDeps = (mx: Array<{ exchange: string; priority?: number }> | Error): CheckDeps => ({
  dns: { resolveTxt: async () => [], resolveMx: async () => { if (mx instanceof Error) throw mx; return mx; } },
  fetcher: { fetch: async () => { throw new Error("no http for MX"); } },
});
const run = (db: ReturnType<typeof world>, d: CheckDeps) => processClaimCheck(db as unknown as CheckStore, d, "c1", at(1000));
const events = (db: ReturnType<typeof world>) => db.t.outboxEvent!.map((e) => e.type);

describe("SEL-035 MX enforced at runtime by the verification-egress group", () => {
  it("MX present: the token mail is requested once (and only now), the claim stays PENDING, no further MX re-checks", async () => {
    const db = world();
    expect(events(db)).not.toContain("claim.business_email_token_requested");
    expect(await run(db, mxDeps([{ exchange: "mx.acme.com", priority: 10 }]))).toBe("MX_PASS");
    expect(db.t.sellerOwnershipClaim![0]).toMatchObject({ status: "PENDING", nextCheckAt: null });
    expect(db.t.outboxEvent!.filter((e) => e.type === "claim.business_email_token_requested")).toEqual([
      expect.objectContaining({ payload: { claimId: "c1", tokenId: "tok1" } }),
    ]);
    expect(db.t.auditLog!.some((a) => a.action === "claim.mx_checked")).toBe(true);
    expect(JSON.stringify(db.t.outboxEvent)).not.toContain("jane@acme.com"); // no address in payloads
    // a duplicate or retried result emits nothing more
    expect(await run(db, mxDeps([{ exchange: "mx.acme.com", priority: 10 }]))).toBe("SKIPPED");
    expect(db.t.outboxEvent!.filter((e) => e.type === "claim.business_email_token_requested")).toHaveLength(1);
    expect(await sweepDueChecks(db as never, { add: async () => undefined }, at(9e6))).toBe(0);
  });

  it("no MX, a null MX and an NXDOMAIN are REJECTED by RULE no_mx; the token is invalidated and no mail is requested", async () => {
    for (const mx of [[], [{ exchange: ".", priority: 0 }], Object.assign(new Error("nx"), { code: "ENOTFOUND" })]) {
      const db = world();
      expect(await run(db, mxDeps(mx))).toBe("REJECTED:no_mx");
      expect(db.t.sellerOwnershipClaim![0]).toMatchObject({ status: "REJECTED", activeKey: null });
      expect(db.t.sellerClaimDecision![0]).toMatchObject({ source: "RULE", outcome: "REJECT", reasonCode: "no_mx", reviewerId: null });
      expect(db.t.emailVerificationToken![0]!.invalidatedAt).not.toBeNull();
      expect(events(db)).toContain("claim.rejected");
      expect(events(db)).not.toContain("claim.business_email_token_requested");
    }
  });

  it("DNS error: back-off retry (still PENDING, nothing mailed), then EXPIRED at the challenge deadline", async () => {
    const db = world();
    expect(await run(db, mxDeps(Object.assign(new Error("x"), { code: "ESERVFAIL" })))).toBe("DNS_ERROR");
    const row = db.t.sellerOwnershipClaim![0]!;
    expect(row).toMatchObject({ status: "PENDING", lastCheckOutcome: "DNS_ERROR" });
    expect(row.nextCheckAt.getTime()).toBeGreaterThan(at(1000).getTime());
    expect(events(db)).not.toContain("claim.business_email_token_requested");
    const queued: string[] = [];
    expect(await sweepDueChecks(db as never, { add: async (_n, d) => { queued.push((d as { claimId: string }).claimId); } }, new Date(row.nextCheckAt.getTime() + 1))).toBe(1); // retried
    expect(queued).toEqual(["c1"]);
    expect(await sweepExpiry(db as never, at(73 * 3_600_000))).toBe(1);
    expect(db.t.sellerOwnershipClaim![0]!.status).toBe("EXPIRED");
  });

  it("a claim that is not PENDING or already passed is not sent to egress", async () => {
    const db = world();
    db.t.sellerOwnershipClaim![0]!.status = "REJECTED";
    expect(await prepareClaimCheck(db as unknown as CheckStore, "c1")).toBeNull();
    expect(await applyClaimObservation(db as unknown as CheckStore, "c1", { observed: [], error: null })).toBe("SKIPPED");
  });

  it("egress: observeMx reports `<pref> <exchange>`, caps at 20, maps errors; runEgressCheck accepts the method and never touches HTTP", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ exchange: `mx${i}.acme.com`, priority: i }));
    expect((await observeMx(mxDeps(many), "acme.com")).observed).toHaveLength(20);
    expect(await observeMx(mxDeps([{ exchange: "mx.acme.com", priority: 5 }]), "acme.com")).toEqual({ observed: ["5 mx.acme.com"], error: null });
    expect(await observeMx(mxDeps(new Error("boom")), "acme.com")).toEqual({ observed: [], error: "DNS_ERROR" });
    expect(await runEgressCheck(mxDeps([{ exchange: "mx.acme.com", priority: 1 }]), { claimId: "c1", method: "BUSINESS_EMAIL_DOMAIN", domain: "acme.com" })).toEqual({ claimId: "c1", observed: ["1 mx.acme.com"], error: null });
    expect((await runEgressCheck(mxDeps([]), { claimId: "c1", method: "BUSINESS_EMAIL_DOMAIN", domain: "bad domain!" })).error).toBe("FETCH_BLOCKED");
  });

  it("T-01 isolation: claim.submitted reaches egress through the queue, and no web route or core processor resolves DNS", () => {
    expect(routes["claim.submitted"]).toBe("verification");
    const web = ["../../../web/src/server/claims.ts", "../../../web/src/server/claim-email.ts"];
    for (const f of web) expect(readFileSync(new URL(f, import.meta.url), "utf8")).not.toMatch(/node:dns|from "dns|resolveMx\(|assertHasMx\(.*lookupMx\b.*process/);
    expect(readFileSync(new URL("../processors.ts", import.meta.url), "utf8")).not.toMatch(/node:dns|resolveMx\(/);
    expect(() => assertEgressEnv({ REDIS_URL: "r", DATABASE_URL: "d" })).toThrow(/forbidden/);
  });
});
