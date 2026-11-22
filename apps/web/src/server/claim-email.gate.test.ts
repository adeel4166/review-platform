import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainNotAllowedError, EmailNotAllowedError, assertClaimableBusinessEmail, assertHasMx, createFakeClaimDb, hashEmailToken } from "@rp/core";

const authMock = vi.fn();
vi.mock("@/server/auth", () => ({ auth: () => authMock(), rotateCookie: async () => undefined, refreshJwt: async () => null }));
vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("@/server/ratelimit", () => ({ limitVerifyEmail: async () => undefined }));
vi.mock("next-auth/jwt", () => ({ getToken: async () => null }));

import { POST as verifyRoute } from "@/app/api/claims/email-verify/route";
import { verifyBusinessEmail } from "./claim-email";
import { submitClaim } from "./claims";
import type { Actor } from "./session";

const NOW = new Date("2026-12-01T10:00:00Z");
const RAW = "r".repeat(43);
const actor = (id: string, o: Partial<Actor> = {}): Actor => ({ id, role: "user", twoFactor: { enrolled: true, verified: true }, stepUpAt: NOW.getTime(), ...o });
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { const x = e as { status?: number; code?: string; reason?: string; message?: string }; return `${x.status ?? ""}:${x.code ?? x.reason ?? x.message}`; } };
const reason = (fn: () => unknown) => { try { fn(); return "ok"; } catch (e) { return e instanceof DomainNotAllowedError || e instanceof EmailNotAllowedError ? (e as { reason: string }).reason : "other"; } };

function world() {
  const db = createFakeClaimDb({
    user: [{ id: "owner", status: "ACTIVE", emailVerifiedAt: new Date("2026-01-01") }],
    seller: [{ id: "S", status: "UNVERIFIED", closedAt: null, nameSkeleton: "acme", nameReviewFlag: false }],
    sellerMember: [{ sellerId: "S", userId: "owner", role: "OWNER" }],
    emailVerificationToken: [],
  });
  const dbx = db as never as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  dbx.sellerMember.findUnique = async ({ where }: any) => db.t.sellerMember!.find((m) => m.sellerId === where.sellerId_userId.sellerId && m.userId === where.sellerId_userId.userId) ?? null; // eslint-disable-line @typescript-eslint/no-explicit-any
  dbx.seller.count = async () => 0;
  const oc = dbx.sellerOwnershipClaim.create;
  dbx.sellerOwnershipClaim.create = async (a: any) => oc({ data: { status: "PENDING", requiresHumanReview: false, requiredApprovals: 1, checkAttempts: 0, createdAt: NOW, ...a.data } }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const ot = dbx.emailVerificationToken.create;
  dbx.emailVerificationToken.create = async (a: any) => ot({ data: { consumedAt: null, invalidatedAt: null, sentAt: null, tokenHash: null, ...a.data } }); // eslint-disable-line @typescript-eslint/no-explicit-any
  return db;
}
const submit = (db: ReturnType<typeof world>, email: string, deps: { lookupMx?: (d: string) => Promise<readonly unknown[]> } = {}) =>
  submitClaim(db as never, actor("owner"), "S", { scope: "SELLER", method: "BUSINESS_EMAIL_DOMAIN", businessEmail: email } as never, { now: NOW, ...deps }) as Promise<{ id: string }>;
const mail = (db: ReturnType<typeof world>) => Object.assign(db.t.emailVerificationToken![0]!, { tokenHash: hashEmailToken(RAW), sentAt: NOW });
beforeEach(() => authMock.mockReset());

describe("SEL-031 address parser", () => {
  it.each([
    ['"jane doe"@acme.com', "invalid_email"], // quoted local part
    ["jane(comment)@acme.com", "invalid_email"], // comment
    ["jane@[192.0.2.1]", "invalid_email"], // IP literal
    ["jané@acme.com", "invalid_email"], // non-ASCII local part
    [`${"a".repeat(65)}@acme.com`, "invalid_email"], // local part > 64
    ["jane@mail.acme.com", "subdomain_mailbox"], // subdomain mailbox
    ["noreply@acme.com", "reserved_local_part"],
  ])("SEL-031: %s is refused with reason %s", (addr, expected) => {
    expect(reason(() => assertClaimableBusinessEmail(addr))).toBe(expected);
  });
  it("SEL-031: info+x@acme.com is classified as a role address; a personal address is not", () => {
    expect(assertClaimableBusinessEmail("info+x@acme.com")).toMatchObject({ localClass: "role", domain: "acme.com" });
    expect(assertClaimableBusinessEmail("jane@acme.com")).toMatchObject({ localClass: "personal" });
  });
});

describe("SEL-033 role and reserved addresses", () => {
  it.each(["noreply", "no-reply", "mailer-daemon", "abuse", "list-request", "owner-list", "bounce+x"])("SEL-033: reserved local part %s is refused at submission", async (local) => {
    const db = world();
    expect(await code(submit(db, `${local}@acme.com`))).toBe("422:email_not_allowed");
    expect(db.t.sellerOwnershipClaim).toHaveLength(0);
  });
  it("SEL-033: role address -> requiresHumanReview ROLE_ADDRESS; the used token lands in the staff queue (C4), the claim and seller are never VERIFIED by RULE", async () => {
    const db = world();
    await submit(db, "sales@acme.com");
    expect(db.t.sellerOwnershipClaim![0]).toMatchObject({ requiresHumanReview: true, humanReviewReason: "ROLE_ADDRESS" });
    mail(db);
    expect(await verifyBusinessEmail(db as never, actor("owner"), RAW, NOW)).toMatchObject({ status: "PENDING" });
    expect(db.t.sellerOwnershipClaim![0]).toMatchObject({ status: "PENDING", lastCheckOutcome: "PASS", requiresHumanReview: true });
    expect(db.t.seller![0]!.status).not.toBe("VERIFIED");
    expect((db.t.sellerClaimDecision ?? []).filter((d) => d.source === "RULE" && d.outcome === "APPROVE")).toHaveLength(0);
  });
});

describe("SEL-034 session binding", () => {
  it("SEL-034: another signed-in user gets 400 and the claimant can still use the token", async () => {
    const db = world();
    db.t.user!.push({ id: "other", status: "ACTIVE", emailVerifiedAt: new Date("2026-01-01") });
    await submit(db, "jane@acme.com"); mail(db);
    expect(await code(verifyBusinessEmail(db as never, actor("other"), RAW, NOW))).toBe("400:invalid_or_expired");
    expect(db.t.emailVerificationToken![0]!.consumedAt).toBeNull();
    expect(await verifyBusinessEmail(db as never, actor("owner"), RAW, NOW)).toMatchObject({ status: "VERIFIED" });
  });
  it("SEL-034: signed out -> 401 and a pending-2FA session -> 401 at the route, before the token is looked at", async () => {
    const req = () => new Request("http://x/api/claims/email-verify", { method: "POST", headers: { "content-type": "application/json", origin: "http://x" }, body: JSON.stringify({ token: RAW }) });
    authMock.mockResolvedValue(null);
    expect((await verifyRoute(req())).status).toBe(401);
    authMock.mockResolvedValue({ pending: true, user: { id: "owner" } });
    expect((await verifyRoute(req())).status).toBe(401);
  });
  it("SEL-034: a claimant demoted to RESPONDER gets 403 and the token is untouched", async () => {
    const db = world();
    await submit(db, "jane@acme.com"); mail(db);
    db.t.sellerMember![0]!.role = "RESPONDER";
    expect((await code(verifyBusinessEmail(db as never, actor("owner"), RAW, NOW))).startsWith("403:")).toBe(true);
    expect(db.t.emailVerificationToken![0]!.consumedAt).toBeNull();
    expect(db.t.sellerOwnershipClaim![0]!.status).toBe("PENDING");
  });
});

describe("SEL-035 MX lookup", () => {
  it("SEL-035: no resolver is invoked by the web submit path unless one is injected (the egress group owns DNS)", async () => {
    const db = world();
    const spy = vi.fn(async () => [{ exchange: "mx.acme.com" }]);
    await submit(db, "jane@acme.com");
    expect(spy).not.toHaveBeenCalled();
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(new URL("./claims.ts", import.meta.url), "utf8")).not.toMatch(/node:dns|from "dns|resolveMx\(/);
  });
  it("SEL-035: no MX, a null MX and a DNS error are all refused as no_mx, and no claim or token is created", async () => {
    for (const lookup of [async () => [], async () => [{ exchange: "." , priority: 0 }], async () => { throw new Error("SERVFAIL"); }]) {
      const db = world();
      expect(await code(submit(db, "jane@acme.com", { lookupMx: lookup }))).toBe("422:domain_not_allowed");
      expect(db.t.sellerOwnershipClaim).toHaveLength(0);
      expect(db.t.emailVerificationToken).toHaveLength(0);
    }
    await expect(assertHasMx("acme.com", async () => [{ exchange: "mx.acme.com", priority: 10 }])).resolves.toBeUndefined();
    await expect(assertHasMx("acme.com", async () => [])).rejects.toMatchObject({ reason: "no_mx" });
  });
  it("SEL-035: submit does not request the token mail; only the egress MX result (core worker, C22) does", async () => {
    const db = world();
    await submit(db, "jane@acme.com");
    expect(db.t.outboxEvent!.map((e) => e.type)).not.toContain("claim.business_email_token_requested");
    expect(db.t.outboxEvent!.map((e) => e.type)).toContain("claim.submitted"); // routed to verification -> egress MX lookup (apps/worker mx-check.test.ts)
  });
});
