import { describe, expect, it } from "vitest";
import { applyClaimTransition, createFakeClaimDb, hashEmailToken } from "@rp/core";
import { denyBusinessEmail, verifyBusinessEmail } from "./claim-email";
import { pendingDecision } from "./pending-gate";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { submitClaim } from "./claims";
import type { Actor } from "./session";

const NOW = new Date("2026-12-01T10:00:00Z");
const actor = (id: string, o: Partial<Actor> = {}): Actor => ({ id, role: "user", twoFactor: { enrolled: true, verified: true }, stepUpAt: NOW.getTime(), ...o });
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { const x = e as { status?: number; code?: string; message?: string }; return `${x.status}:${x.code ?? x.message}`; } };
const RAW = "r".repeat(43);

function world() {
  const db = createFakeClaimDb({
    user: [{ id: "owner", status: "ACTIVE", emailVerifiedAt: new Date("2026-01-01") }, { id: "colleague", status: "ACTIVE", emailVerifiedAt: new Date("2026-01-01") }],
    seller: [{ id: "S", status: "UNVERIFIED", closedAt: null, nameSkeleton: "acme", nameReviewFlag: false }],
    sellerMember: [{ sellerId: "S", userId: "owner", role: "OWNER" }, { sellerId: "S", userId: "colleague", role: "MANAGER" }],
    emailVerificationToken: [],
  });
  const dbx = db as never as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  dbx.sellerMember.findUnique = async ({ where }: any) => db.t.sellerMember!.find((m) => m.sellerId === where.sellerId_userId.sellerId && m.userId === where.sellerId_userId.userId) ?? null; // eslint-disable-line @typescript-eslint/no-explicit-any
  dbx.seller.count = async () => 0;
  const origCreate = dbx.sellerOwnershipClaim.create;
  dbx.sellerOwnershipClaim.create = async (a: any) => origCreate({ data: { status: "PENDING", requiresHumanReview: false, requiredApprovals: 1, checkAttempts: 0, createdAt: NOW, ...a.data } }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const origTok = dbx.emailVerificationToken.create;
  dbx.emailVerificationToken.create = async (a: any) => origTok({ data: { consumedAt: null, invalidatedAt: null, sentAt: null, tokenHash: null, ...a.data } }); // eslint-disable-line @typescript-eslint/no-explicit-any
  return db;
}
const submit = (db: ReturnType<typeof world>, email: string, domain?: string, who = "owner") =>
  submitClaim(db as never, actor(who), "S", { scope: "SELLER", method: "BUSINESS_EMAIL_DOMAIN", businessEmail: email, ...(domain ? { domain } : {}) } as never, { now: NOW }) as Promise<{ id: string; status: string }>;
/** Simulates the worker: mint the raw token for the claim's token row. */
const mail = (db: ReturnType<typeof world>, raw = RAW) => Object.assign(db.t.emailVerificationToken![0]!, { tokenHash: hashEmailToken(raw), sentAt: NOW });

describe("business e-mail claim policy (SEL-031)", () => {
  it.each([
    ["ceo@gmail.com", "422:domain_not_allowed"],
    ["ceo@hotmail.fr", "422:domain_not_allowed"],
    ["ceo@mail.acme.com", "422:domain_not_allowed"], // shared suffix / subdomain mailbox
    ["ceo@brand.github.io", "422:domain_not_allowed"],
    ["ceo@shop.myshopify.com", "422:domain_not_allowed"],
    ["noreply@acme.com", "422:email_not_allowed"],
    ["ceo@[1.2.3.4]", "422:email_not_allowed"],
  ])("refuses %s", async (email, expected) => {
    const db = world();
    expect(await code(submit(db, email))).toBe(expected);
    expect(db.t.sellerOwnershipClaim).toHaveLength(0);
    expect(db.t.emailVerificationToken).toHaveLength(0);
  });
  it("a claimed domain that differs from the mail domain is refused", async () => {
    expect(await code(submit(world(), "ceo@acme.com", "other.com"))).toBe("422:domain_not_allowed");
  });
  it("replaces the 501: stores the address on the claim, issues a user-bound token, never leaks the address into audit/outbox", async () => {
    const db = world();
    const c = await submit(db, "Jane@Acme.com");
    expect(c.status).toBe("PENDING");
    expect(db.t.sellerOwnershipClaim![0]).toMatchObject({ method: "BUSINESS_EMAIL_DOMAIN", domain: "acme.com", businessEmail: "Jane@Acme.com", requiresHumanReview: false });
    expect(db.t.emailVerificationToken![0]).toMatchObject({ purpose: "CLAIM_BUSINESS_EMAIL", userId: "owner", email: "Jane@Acme.com", claimId: c.id, tokenHash: null });
    expect(JSON.stringify([db.t.auditLog, db.t.outboxEvent])).not.toMatch(/jane@acme/i);
  });
  it("a role address needs human review", async () => {
    const db = world();
    await submit(db, "info@acme.com");
    expect(db.t.sellerOwnershipClaim![0]).toMatchObject({ requiresHumanReview: true, humanReviewReason: "ROLE_ADDRESS" });
  });
  it("a viewer without OWNER/MANAGER role cannot submit; per-user and per-domain limits apply", async () => {
    const db = world();
    expect(await code(submit(db, "a@acme.com", undefined, "stranger"))).not.toBe("ok");
    await submit(db, "a@acme.com");
    db.t.sellerOwnershipClaim![0]!.status = "REJECTED"; db.t.sellerOwnershipClaim![0]!.activeKey = null;
    await submit(db, "b@acme.com");
    db.t.sellerOwnershipClaim![1]!.status = "REJECTED"; db.t.sellerOwnershipClaim![1]!.activeKey = null;
    await submit(db, "c@acme.com");
    db.t.sellerOwnershipClaim![2]!.status = "REJECTED"; db.t.sellerOwnershipClaim![2]!.activeKey = null;
    expect(await code(submit(db, "d@acme.com"))).toBe("429:rate_limited"); // 3 per domain per 7 days
  });
});

describe("token consumption bound to the session user (link replay, 4.4)", () => {
  it("the submitter with a verified, 2FA session consumes the token and the claim is auto-approved", async () => {
    const db = world();
    const c = await submit(db, "jane@acme.com");
    mail(db);
    expect(await verifyBusinessEmail(db as never, actor("owner"), RAW, NOW)).toMatchObject({ id: c.id, status: "VERIFIED" });
    expect(db.t.emailVerificationToken![0]!.consumedAt).toEqual(NOW);
    expect(db.t.seller![0]!.status).toBe("VERIFIED");
  });
  it("replay by ANOTHER user (colleague, same seller) fails uniformly and does not consume the token", async () => {
    const db = world();
    await submit(db, "jane@acme.com");
    mail(db);
    expect(await code(verifyBusinessEmail(db as never, actor("colleague"), RAW, NOW))).toBe("400:invalid_or_expired");
    expect(db.t.emailVerificationToken![0]!.consumedAt).toBeNull();
    expect(db.t.sellerOwnershipClaim![0]!.status).toBe("PENDING");
    // the rightful user can still use it afterwards
    expect(await verifyBusinessEmail(db as never, actor("owner"), RAW, NOW)).toMatchObject({ status: "VERIFIED" });
  });
  it("replaying a consumed token, an expired token, an unsent token and garbage all give the same 400", async () => {
    const db = world();
    await submit(db, "jane@acme.com");
    expect(await code(verifyBusinessEmail(db as never, actor("owner"), RAW, NOW))).toBe("400:invalid_or_expired"); // not mailed yet
    mail(db);
    expect(await code(verifyBusinessEmail(db as never, actor("owner"), RAW, new Date(NOW.getTime() + 25 * 3_600_000)))).toBe("400:invalid_or_expired");
    expect(await code(verifyBusinessEmail(db as never, actor("owner"), "nope-nope-nope-nope-nope", NOW))).toBe("400:invalid_or_expired");
    await verifyBusinessEmail(db as never, actor("owner"), RAW, NOW);
    expect(await code(verifyBusinessEmail(db as never, actor("owner"), RAW, NOW))).toBe("400:invalid_or_expired");
  });
  it("an OWNER session without verified 2FA gets the guard's 403 and the token is untouched", async () => {
    const db = world();
    await submit(db, "jane@acme.com");
    mail(db);
    expect(await code(verifyBusinessEmail(db as never, actor("owner", { twoFactor: { enrolled: true, verified: false } }), RAW, NOW))).toBe("403:TWO_FACTOR_REQUIRED");
    expect(db.t.emailVerificationToken![0]!.consumedAt).toBeNull();
  });
  it("a role-address claim passes the check but stays PENDING for staff (never auto-approved)", async () => {
    const db = world();
    await submit(db, "info@acme.com");
    mail(db);
    expect(await verifyBusinessEmail(db as never, actor("owner"), RAW, NOW)).toMatchObject({ status: "PENDING" });
    expect(db.t.sellerOwnershipClaim![0]).toMatchObject({ lastCheckOutcome: "PASS" });
  });
});

describe("deny link (C21)", () => {
  it("rejects the claim without sign-in, flags the seller, and cannot be used afterwards", async () => {
    const db = world();
    await submit(db, "jane@acme.com");
    mail(db);
    expect(await denyBusinessEmail(db as never, RAW, NOW)).toEqual({ status: "REJECTED" });
    expect(db.t.sellerOwnershipClaim![0]).toMatchObject({ status: "REJECTED", activeKey: null });
    expect(db.t.seller![0]!.nameReviewFlag).toBe(true);
    expect(db.t.outboxEvent!.map((e) => e.type)).toContain("claim.mailbox_denied");
    expect(await code(denyBusinessEmail(db as never, RAW, NOW))).toBe("400:invalid_or_expired");
    expect(await code(verifyBusinessEmail(db as never, actor("owner"), RAW, NOW))).toBe("400:invalid_or_expired");
  });
});

// ---- M3b gate (task #63): SEL-033, SEL-034, SEL-035 ----
describe("SEL-033: role address token use queues for staff (C4)", () => {
  it("a role address whose token is used stays PENDING for staff: requiresHumanReview, seller PENDING_VERIFICATION, no RULE approval", async () => {
    const db = world();
    await submit(db, "info@acme.com");
    mail(db);
    expect(await verifyBusinessEmail(db as never, actor("owner"), RAW, NOW)).toMatchObject({ status: "PENDING" });
    expect(db.t.sellerOwnershipClaim![0]).toMatchObject({ status: "PENDING", requiresHumanReview: true });
    expect(db.t.seller![0]!.status).toBe("PENDING_VERIFICATION"); // open claim: never VERIFIED by a RULE approval
    expect((db.t.sellerClaimDecision ?? []).filter((d) => d.source === "RULE" && d.outcome === "APPROVE")).toEqual([]);
  });
  it.each(["abuse@acme.com", "x-request@acme.com", "owner-list@acme.com", "bounces@acme.com"])("SEL-033: reserved %s is refused before any claim row exists", async (email) => {
    const db = world();
    expect(await code(submit(db, email))).toBe("422:email_not_allowed");
    expect(db.t.sellerOwnershipClaim).toHaveLength(0);
  });
});

describe("SEL-034: claim e-mail session binding", () => {
  it("claimant demoted to RESPONDER after submitting -> 403 and the token is not consumed", async () => {
    const db = world();
    await submit(db, "jane@acme.com");
    mail(db);
    db.t.sellerMember!.find((m) => m.userId === "owner")!.role = "RESPONDER";
    expect(await code(verifyBusinessEmail(db as never, actor("owner"), RAW, NOW))).toBe("403:FORBIDDEN_ROLE");
    expect(db.t.emailVerificationToken![0]!.consumedAt).toBeNull();
  });
  it("pending 2FA session: the email-verify API paths are denied by the pending gate (API calls get 401)", () => {
    expect(pendingDecision("/api/claims/email-verify")).toBe("deny");
    expect(pendingDecision("/api/claims/email-verify/deny")).toBe("deny");
  });
  it.todo("SEL-034: signed-out request -> 401 (NOT RUN here: needs the route and session harness, covered by E2E)");
});

describe("SEL-035: MX resolver placement and DNS back-off", () => {
  it("no web route injects the MX resolver (lookupMx is only an optional dependency of the claim service)", () => {
    const root = fileURLToPath(new URL("../app", import.meta.url));
    const offenders = (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts") && readFileSync(join(root, f), "utf8").includes("lookupMx"));
    expect(offenders).toEqual([]);
  });
  it("a DNS error backs off (nextCheckAt grows) and the claim EXPIRES at the challenge deadline, never earlier", async () => {
    const db = world();
    const c = await submit(db, "jane@acme.com");
    const row = () => db.t.sellerOwnershipClaim![0]!;
    const sys = { id: null, type: "SYSTEM" as const };
    const deadline = row().challengeExpiresAt as Date;
    expect((await applyClaimTransition(db as never, c.id, { action: "CHECK_FAILED", outcome: "DNS_ERROR" }, sys, NOW)).status).toBe("PENDING");
    expect(row().nextCheckAt).toEqual(new Date(NOW.getTime() + 5 * 60_000));
    const t2 = new Date(NOW.getTime() + 6 * 60_000);
    expect((await applyClaimTransition(db as never, c.id, { action: "CHECK_FAILED", outcome: "DNS_ERROR" }, sys, t2)).status).toBe("PENDING");
    expect(row().nextCheckAt).toEqual(new Date(t2.getTime() + 15 * 60_000));
    expect((await applyClaimTransition(db as never, c.id, { action: "EXPIRE_CHALLENGE" }, sys, new Date(deadline.getTime() - 1))).status).toBe("PENDING");
    expect((await applyClaimTransition(db as never, c.id, { action: "EXPIRE_CHALLENGE" }, sys, new Date(deadline.getTime() + 1))).status).toBe("EXPIRED");
    expect(row()).toMatchObject({ status: "EXPIRED", endReason: "CHALLENGE_TIMEOUT" });
  });
});
