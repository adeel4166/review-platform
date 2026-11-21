import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTwoFactorDb } from "./two-factor-fake";

const f = vi.hoisted(() => ({ cfg: undefined as undefined | { callbacks: Record<string, (a: Record<string, unknown>) => unknown> }, store: undefined as unknown }));
vi.mock("./db", async () => {
  const { makeTwoFactorDb } = await import("./two-factor-fake");
  f.store = makeTwoFactorDb();
  return { db: (f.store as ReturnType<typeof makeTwoFactorDb>).db };
});
vi.mock("@rp/db", () => ({ hashPassword: async () => "h", verifyPassword: async () => false }));
vi.mock("next-auth", () => ({ default: (cfg: typeof f.cfg) => { f.cfg = cfg; return { handlers: {}, auth: () => null, signIn: () => null, signOut: () => null, unstable_update: async () => null }; } }));
vi.mock("next-auth/providers/credentials", () => ({ default: () => ({}) }));

import { refreshJwt } from "./auth";
import { sessionVersion } from "./auth";

const T = new Date("2026-11-21T12:00:00Z");
const VERIFIED = new Date("2026-11-01T00:00:00Z");
const s = () => (f.store as ReturnType<typeof makeTwoFactorDb>).state;
const jwt = (a: Record<string, unknown>) => f.cfg!.callbacks.jwt!(a) as Promise<Record<string, unknown> | null>;

beforeEach(() => {
  const st = s();
  for (const k of Object.keys(st) as (keyof typeof st)[]) st[k].length = 0;
  st.user.push({ id: "u1", status: "ACTIVE", emailVerifiedAt: VERIFIED, roles: [] }, { id: "u2", status: "ACTIVE", emailVerifiedAt: VERIFIED, roles: [] });
});
const signIn = (id = "u1") => refreshJwt({} as Record<string, unknown>, { id, sessionVersion: sessionVersion(VERIFIED) }, T) as Promise<Record<string, unknown>>;

describe("jwt callback (AUT-018, AUT-019, AUT-026)", () => {
  it("a pre-M3b JWT without sid, or with another user's sid, is signed out", async () => {
    expect(await refreshJwt({ sub: "u1", sv: sessionVersion(VERIFIED) }, undefined, T)).toBeNull();
    const t = await signIn("u1");
    expect(await refreshJwt({ sub: "u2", sv: sessionVersion(VERIFIED), sid: t.sid }, undefined, T)).toBeNull();
  });

  it("sign-in without 2FA yields a full session; with 2FA enrolled it is pending and hidden from the session callback", async () => {
    const full = await signIn();
    expect(full).toMatchObject({ pnd: false, tfe: false, tfv: false });
    s().twoFactorTotp.push({ userId: "u2", confirmedAt: T });
    const pending = await signIn("u2");
    expect(pending.pnd).toBe(true);
    const sess = f.cfg!.callbacks.session!({ session: { expires: "x", user: {} }, token: pending }) as Record<string, unknown>;
    expect(sess).toEqual({ expires: "x", pending: true }); // no user.id anywhere
  });

  it("a client-supplied update payload cannot change sid, pending or role", async () => {
    s().twoFactorTotp.push({ userId: "u2", confirmedAt: T });
    const pending = await signIn("u2");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(T.getTime() + 1000));
    const out = await jwt({ token: { ...pending }, trigger: "update", session: { sid: "other", pnd: false, role: "admin", tfv: true, user: { id: "u1" } } });
    vi.useRealTimers();
    expect(out).toMatchObject({ sid: pending.sid, pnd: true, role: "user", tfv: false, sub: "u2" });
  });

  it("revocation applies on the next read; staff idle timeout is 2 h", async () => {
    const t = await signIn();
    s().userSession[0]!.revokedAt = T;
    s().userSession[0]!.revokeReason = "signed_out";
    expect(await refreshJwt({ ...t }, undefined, T)).toBeNull();
    s().userRole.length = 0;
    s().user[1]!.roles = [{ role: "ADMIN" }];
    const staff = await signIn("u2");
    expect(await refreshJwt({ ...staff }, undefined, new Date(T.getTime() + 2 * 3600_000 + 1000))).toBeNull();
  });

  it("the successor is claimed once: a replayed old JWT is signed out", async () => {
    s().twoFactorTotp.push({ userId: "u2", confirmedAt: T });
    const old = await signIn("u2");
    const row = s().userSession.find((r) => r.id === old.sid)!;
    s().userSession.push({ id: "next", userId: "u2", secondFactorPending: false, pendingExpiresAt: null, secondFactorVerifiedAt: T, secondFactorMethod: "TOTP", revokedAt: null, successorId: null, successorClaimedAt: null, lastSeenAt: T, absoluteExpiresAt: new Date(T.getTime() + 1e9), reauthenticatedAt: null });
    Object.assign(row, { revokedAt: T, revokeReason: "rotated", successorId: "next" });
    const claimed = await refreshJwt({ ...old }, undefined, new Date(T.getTime() + 5000));
    expect(claimed).toMatchObject({ sid: "next", pnd: false, tfv: true });
    expect(await refreshJwt({ ...old }, undefined, new Date(T.getTime() + 6000))).toBeNull();
  });
});
void makeTwoFactorDb;
