import { describe, expect, it, vi } from "vitest";
import { hashEmailToken } from "@rp/core";

// In-memory user store shared by the mocked db, registration and verification.
interface U { id: string; email: string; passwordHash: string; status: string; emailVerifiedAt: Date | null; displayName: string; roles: { role: string }[]; createdAt: Date; handle: string }
const users: U[] = [];
const sessions: Record<string, unknown>[] = [];
vi.mock("./db", () => ({
  db: { user: {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<U> }) => { Object.assign(users.find((u) => u.id === where.id)!, data); },
  },
  twoFactorTotp: { findUnique: async () => null },
  userSession: {
    create: async ({ data }: { data: Record<string, unknown> }) => { const r = { id: `s${sessions.length + 1}`, revokedAt: null, successorId: null, successorClaimedAt: null, ...data }; sessions.push(r); return r; },
    findUnique: async ({ where }: { where: { id: string } }) => sessions.find((x) => x.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(sessions.find((x) => x.id === where.id)!, data),
  } },
}));
vi.mock("@rp/db", () => ({
  hashPassword: async (p: string) => `h:${p}`,
  verifyPassword: async (h: string, p: string) => h === `h:${p}`,
}));
vi.mock("next-auth", () => ({ default: () => ({ handlers: {}, auth: () => null, signIn: () => null, signOut: () => null }) }));
vi.mock("next-auth/providers/credentials", () => ({ default: () => ({}) }));

import { authorizeCredentials, refreshJwt } from "./auth";
import { registerAccount, UNVERIFIED_ACCOUNT_TTL_MS } from "./registration";
import { verifyEmailToken, type VerifyDb } from "./email-verification";
import { registerInput } from "./validation";

const NOW = new Date("2026-11-21T12:00:00Z");
const RAW = "raw-token-raw-token-raw-token";

function registrationDb() {
  const tx = {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => users.find((u) => u.email === where.email) ?? null,
      create: async ({ data }: { data: Partial<U> }) => { const u = { id: `u${users.length + 1}`, status: "ACTIVE", emailVerifiedAt: null, roles: [], displayName: "x", createdAt: NOW, ...data } as U; users.push(u); return { id: u.id }; },
      update: async ({ where, data }: { where: { id: string }; data: Partial<U> }) => { Object.assign(users.find((u) => u.id === where.id)!, data); },
    },
    emailVerificationToken: { create: async () => ({ id: "t1" }), updateMany: async () => ({ count: 1 }) },
    outboxEvent: { create: async () => ({}) },
  };
  return { user: { findUnique: async () => null }, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
}
function verifyDb() {
  const tok = { id: "t1", userId: "", purpose: "ACCOUNT_EMAIL", email: "victim@x.io", sentAt: new Date(NOW.getTime() - 1000), consumedAt: null as Date | null, invalidatedAt: null, expiresAt: new Date(NOW.getTime() + 3600_000) };
  const db = {
    emailVerificationToken: {
      findUnique: async (a: { where: { tokenHash: string } }) => (a.where.tokenHash === hashEmailToken(RAW) ? tok : null),
      updateMany: async (a: { data: { consumedAt?: Date } }) => { if (a.data.consumedAt) { if (tok.consumedAt) return { count: 0 }; tok.consumedAt = a.data.consumedAt; } return { count: 1 }; },
      create: async () => ({ id: "t" }), count: async () => 0,
    },
    user: { findUnique: async ({ where }: { where: { id: string } }) => users.find((u) => u.id === where.id) ?? null, update: async ({ where, data }: { where: { id: string }; data: Partial<U> }) => { Object.assign(users.find((u) => u.id === where.id)!, data); } },
    outboxEvent: { create: async () => ({}) }, auditLog: { create: async () => ({}) },
    $transaction: async (fn: (t: unknown) => unknown) => fn(db),
  };
  return { db: db as unknown as VerifyDb, tok };
}
const hash = async (p: string) => `h:${p}`;

describe("T-02 pre-hijacking regression", () => {
  it("attacker registers victim email -> victim verifies -> attacker old password AND old session fail", async () => {
    users.length = 0;
    await registerAccount(registrationDb() as never, registerInput.parse({ email: "victim@x.io", password: "attacker-password-1", handle: "atk", displayName: "A" }), hash, NOW);
    const victimAccount = users[0]!;
    // the attacker logs in while unverified and holds a session
    const login = await authorizeCredentials({ email: "victim@x.io", password: "attacker-password-1" });
    expect(login).toBeTruthy();
    const attackerToken = await refreshJwt({} as { sub?: string; sv?: unknown }, login as never);
    expect(attackerToken).not.toBeNull();
    expect(await refreshJwt({ ...attackerToken! })).not.toBeNull(); // valid until verification

    // victim clicks the mailed link: without choosing a password it is refused
    const v = verifyDb(); v.tok.userId = victimAccount.id;
    await expect(verifyEmailToken(v.db, RAW, NOW)).rejects.toMatchObject({ code: "password_required" });
    expect(victimAccount.emailVerifiedAt).toBeNull();
    v.tok.consumedAt = null; // the real transaction rolls the token consumption back; the in-memory fake cannot
    await verifyEmailToken(v.db, RAW, NOW, await hash("victim-new-password"));
    expect(victimAccount.emailVerifiedAt).toEqual(NOW);

    expect(await authorizeCredentials({ email: "victim@x.io", password: "attacker-password-1" })).toBeNull(); // old password
    expect(await refreshJwt({ ...attackerToken! })).toBeNull(); // old session
    const victim = await authorizeCredentials({ email: "victim@x.io", password: "victim-new-password" });
    expect(victim).toBeTruthy();
    expect(await refreshJwt({} as { sub?: string; sv?: unknown }, victim as never)).not.toBeNull(); // new session works
  });

  it("an unverified account older than 7 days can be re-registered (credentials replaced); a younger one cannot", async () => {
    users.length = 0;
    await registerAccount(registrationDb() as never, registerInput.parse({ email: "v@x.io", password: "attacker-password-1", handle: "atk", displayName: "A" }), hash, NOW);
    const later = new Date(NOW.getTime() + UNVERIFIED_ACCOUNT_TTL_MS - 1000);
    await registerAccount(registrationDb() as never, registerInput.parse({ email: "v@x.io", password: "owner-password-12", handle: "own", displayName: "O" }), hash, later);
    expect(users[0]!.passwordHash).toBe("h:attacker-password-1"); // too young: untouched
    const old = new Date(NOW.getTime() + UNVERIFIED_ACCOUNT_TTL_MS + 1000);
    await registerAccount(registrationDb() as never, registerInput.parse({ email: "v@x.io", password: "owner-password-12", handle: "own", displayName: "O" }), hash, old);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ passwordHash: "h:owner-password-12", handle: "own" });
  });
});
