import { describe, expect, it, vi } from "vitest";
import { hashEmailToken } from "@rp/core";
import { registerAccount } from "./registration";
import { resendVerification, verifyEmailToken, type VerifyDb } from "./email-verification";
import { registerInput } from "./validation";

const input = registerInput.parse({ email: "A@x.io", password: "correct horse battery", handle: "alice", displayName: "A" });

function regDb(existing: boolean, opts: { handleTaken?: boolean } = {}) {
  const outbox: Array<{ type: string }> = [];
  const tx = {
    user: { findUnique: vi.fn(async () => (existing ? { id: "u1" } : null)), create: vi.fn(async () => ({ id: "u2" })) },
    emailVerificationToken: { create: vi.fn(async () => ({ id: "t1" })) },
    outboxEvent: { create: vi.fn(async (a: { data: { type: string } }) => { outbox.push(a.data); }) },
  };
  const db = {
    user: { findUnique: vi.fn(async () => (opts.handleTaken ? { id: "x" } : null)) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { db, tx, outbox };
}

describe("registerAccount (SEC-05)", () => {
  it("returns the identical response for a new and an existing email, hashing the password on both", async () => {
    const hash = vi.fn(async () => "h");
    const a = regDb(false), b = regDb(true);
    const ra = await registerAccount(a.db as never, input, hash);
    const rb = await registerAccount(b.db as never, input, hash);
    expect(ra).toEqual(rb);
    expect(ra).toEqual({ status: "verification_sent" });
    expect(hash).toHaveBeenCalledTimes(2);
    expect(a.tx.user.create).toHaveBeenCalled();
    expect(a.outbox.map((o) => o.type)).toEqual(["user.email_verification_requested"]);
    expect(b.tx.user.create).not.toHaveBeenCalled();
    expect(b.outbox.map((o) => o.type)).toEqual(["user.registration_conflict"]);
  });
  it("never stores a token hash at registration (worker generates it)", async () => {
    const a = regDb(false);
    await registerAccount(a.db as never, input, async () => "h");
    expect(JSON.stringify(a.tx.emailVerificationToken.create.mock.calls)).not.toContain("tokenHash");
  });
  it("handle conflicts are 409 (handles are public)", async () => {
    await expect(registerAccount(regDb(false, { handleTaken: true }).db as never, input, async () => "h")).rejects.toMatchObject({ status: 409 });
  });
  it("an email race (P2002 on email) takes the known-email path", async () => {
    const r = regDb(false);
    let first = true;
    r.db.$transaction.mockImplementation(async (fn: (t: typeof r.tx) => unknown) => {
      if (first) { first = false; throw Object.assign(new Error("dup"), { code: "P2002", meta: { target: "users_email_key" } }); }
      r.tx.user.findUnique.mockResolvedValue({ id: "u1" });
      return fn(r.tx);
    });
    expect(await registerAccount(r.db as never, input, async () => "h")).toEqual({ status: "verification_sent" });
    expect(r.outbox.map((o) => o.type)).toEqual(["user.registration_conflict"]);
  });
});

const NOW = new Date("2026-11-21T12:00:00Z");
function verifyDb(row: Partial<{ sentAt: Date | null; consumedAt: Date | null; invalidatedAt: Date | null; expiresAt: Date; purpose: string; email: string }> | null, userEmail = "a@x.io") {
  const token = row && { id: "t1", userId: "u1", purpose: "ACCOUNT_EMAIL", email: "a@x.io", sentAt: new Date(NOW.getTime() - 1000), consumedAt: null, invalidatedAt: null, expiresAt: new Date(NOW.getTime() + 3600_000), ...row };
  const state = { consumed: false, verified: false };
  const db = {
    emailVerificationToken: {
      findUnique: vi.fn(async (a: { where: { tokenHash: string } }) => (a.where.tokenHash === hashEmailToken("raw-token-raw-token-raw-token") ? token : null)),
      updateMany: vi.fn(async (a: { data: { consumedAt?: Date } }) => {
        if (a.data.consumedAt) { if (state.consumed) return { count: 0 }; state.consumed = true; }
        return { count: 1 };
      }),
      create: vi.fn(), count: vi.fn(async () => 0),
    },
    user: { findUnique: vi.fn(async () => ({ id: "u1", email: userEmail, emailVerifiedAt: null })), update: vi.fn(async () => { state.verified = true; }) },
    outboxEvent: { create: vi.fn() }, auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(db)),
  };
  return { db: db as unknown as VerifyDb, raw: db, state };
}
const RAW = "raw-token-raw-token-raw-token";

describe("verifyEmailToken", () => {
  it("verifies once; replaying the token fails", async () => {
    const { db, state } = verifyDb({});
    await verifyEmailToken(db, RAW, NOW);
    expect(state.verified).toBe(true);
    await expect(verifyEmailToken(db, RAW, NOW)).rejects.toMatchObject({ status: 400, code: "invalid_or_expired" });
  });
  it("rejects an expired token", async () => {
    const { db, state } = verifyDb({ expiresAt: new Date(NOW.getTime() - 1) });
    await expect(verifyEmailToken(db, RAW, NOW)).rejects.toMatchObject({ code: "invalid_or_expired" });
    expect(state.verified).toBe(false);
  });
  it("gives the same error for unknown, consumed, invalidated, unsent, wrong-purpose and email-changed tokens", async () => {
    const cases = [verifyDb(null), verifyDb({ consumedAt: NOW }), verifyDb({ invalidatedAt: NOW }), verifyDb({ sentAt: null }), verifyDb({ purpose: "CLAIM_BUSINESS_EMAIL" }), verifyDb({}, "changed@x.io")];
    for (const c of cases) await expect(verifyEmailToken(c.db, RAW, NOW)).rejects.toMatchObject({ status: 400, code: "invalid_or_expired", message: "This link is invalid or has expired" });
  });
});

describe("resendVerification", () => {
  it("invalidates open tokens, issues a new one and queues it", async () => {
    const { db, raw } = verifyDb({});
    raw.emailVerificationToken.create.mockResolvedValue({ id: "t2" });
    expect(await resendVerification(db, "u1", NOW)).toBe("queued");
    expect(raw.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "user.email_verification_requested", payload: { tokenId: "t2" } }) });
  });
  it("is rate limited to 3/hour", async () => {
    const { db, raw } = verifyDb({});
    raw.emailVerificationToken.count.mockResolvedValue(3);
    expect(await resendVerification(db, "u1", NOW)).toBe("limited");
    expect(raw.outboxEvent.create).not.toHaveBeenCalled();
  });
});
