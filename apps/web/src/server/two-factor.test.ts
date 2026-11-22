import { base32Decode, generateTotpSecret, hotp, parseKeyRing, sealSecret, totpAad, totpStep } from "@rp/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmEnrolment, disableTwoFactor, regenerateRecoveryCodes, startEnrolment, stepUp, verifySecondFactor, type TfDeps, type TfDb } from "./two-factor";
import { makeTwoFactorDb } from "./two-factor-fake";
import { HttpError } from "./http";
import { assertFreshStepUp, createSession, sessionVerdict } from "./user-sessions";

const NOW0 = new Date("2026-11-21T12:00:00Z");
let now = NOW0;
const key = (b: number) => Buffer.alloc(32, b).toString("base64");
const limit = vi.fn(async () => undefined);
const deps = (): TfDeps => ({
  now: () => now,
  totpKeys: () => parseKeyRing(JSON.stringify({ k1: key(1) }), "k1"),
  peppers: () => parseKeyRing(JSON.stringify({ p1: key(2) }), "p1"),
  limit,
});
const codeAt = (secret: Buffer, t = now) => hotp(secret, totpStep(t.getTime()));

let f: ReturnType<typeof makeTwoFactorDb>;
let db: TfDb;
const err = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as HttpError);

/** An account with confirmed TOTP, returning its plaintext secret. */
function enrolled(userId = "u1", o: { staff?: boolean } = {}) {
  const secret = generateTotpSecret();
  const sealed = sealSecret(deps().totpKeys(), secret, totpAad(userId, "t1"));
  f.state.user.push({ id: userId, email: `${userId}@x.io`, emailVerifiedAt: NOW0, passwordHash: "h:pw" });
  f.state.twoFactorTotp.push({ id: "t1", userId, secretCiphertext: new Uint8Array(sealed.ciphertext), keyId: sealed.keyId, confirmedAt: NOW0, lastUsedStep: null, pendingSecretCiphertext: null, pendingKeyId: null, pendingExpiresAt: null });
  if (o.staff) f.state.userRole.push({ userId, role: "ADMIN" });
  return secret;
}
const pendingSession = (userId = "u1") => createSession(f.db as never, { userId, pending: true, staff: false, now });
const fullSession = async (userId = "u1") => {
  const id = await createSession(f.db as never, { userId, pending: false, staff: false, now });
  Object.assign(f.state.userSession.find((s) => s.id === id)!, { secondFactorVerifiedAt: now, secondFactorMethod: "TOTP" });
  return id;
};
const addRecoveryCodes = async (userId = "u1") => {
  const r = await regenerateRecoveryCodes(db, deps(), { userId, stepUpAt: now.getTime() });
  return r.recoveryCodes;
};

beforeEach(() => {
  now = NOW0;
  limit.mockReset();
  limit.mockResolvedValue(undefined);
  f = makeTwoFactorDb();
  db = f.db as unknown as TfDb;
});

describe("verifySecondFactor", () => {
  it("accepts a valid code, rotates the pending session to a verified successor (AUT-018)", async () => {
    const secret = enrolled();
    const sid = await pendingSession();
    const r = await verifySecondFactor(db, deps(), { sid, userId: "u1", code: codeAt(secret), kind: "TOTP" });
    const old = f.state.userSession.find((s) => s.id === sid)!;
    expect(old).toMatchObject({ revokedAt: NOW0, revokeReason: "rotated", successorId: r.sid });
    expect(f.state.userSession.find((s) => s.id === r.sid)).toMatchObject({ secondFactorPending: false, secondFactorMethod: "TOTP" });
    expect(f.state.auditLog.map((a) => a.action)).toContain("auth.2fa.verified");
  });

  it("rejects a replayed code (AUT-004): the same step cannot be used twice, even across sessions", async () => {
    const secret = enrolled();
    const code = codeAt(secret);
    await verifySecondFactor(db, deps(), { sid: await pendingSession(), userId: "u1", code, kind: "TOTP" });
    const e = await err(verifySecondFactor(db, deps(), { sid: await pendingSession(), userId: "u1", code, kind: "TOTP" }));
    expect(e).toMatchObject({ status: 400, code: "invalid_code" });
  });

  it("two simultaneous submissions of one code: exactly one wins", async () => {
    const secret = enrolled();
    const code = codeAt(secret);
    const [a, b] = [await pendingSession(), await pendingSession()];
    const res = await Promise.all([a, b].map((sid) => err(verifySecondFactor(db, deps(), { sid, userId: "u1", code, kind: "TOTP" }))));
    expect(res.filter((e) => e === null)).toHaveLength(1);
  });

  it("a code from a stale step is refused but an adjacent step is accepted (window +-1)", async () => {
    const secret = enrolled();
    const sid = await pendingSession();
    expect(await err(verifySecondFactor(db, deps(), { sid, userId: "u1", code: codeAt(secret, new Date(now.getTime() - 120_000)), kind: "TOTP" }))).toMatchObject({ code: "invalid_code" });
    await verifySecondFactor(db, deps(), { sid, userId: "u1", code: codeAt(secret, new Date(now.getTime() - 30_000)), kind: "TOTP" });
  });

  it("5 failures kill the pending session; the correct code afterwards is refused (per-session cap)", async () => {
    const secret = enrolled();
    const sid = await pendingSession();
    for (let i = 1; i <= 4; i++) expect(await err(verifySecondFactor(db, deps(), { sid, userId: "u1", code: "000000", kind: "TOTP" }))).toMatchObject({ code: "invalid_code" });
    expect(await err(verifySecondFactor(db, deps(), { sid, userId: "u1", code: "000000", kind: "TOTP" }))).toMatchObject({ status: 401, code: "session_ended" });
    expect(f.state.userSession.find((s) => s.id === sid)).toMatchObject({ revokeReason: "second_factor_failed" });
    expect(await err(verifySecondFactor(db, deps(), { sid, userId: "u1", code: codeAt(secret), kind: "TOTP" }))).toMatchObject({ code: "session_ended" });
    expect(f.state.auditLog.map((a) => a.action)).toContain("auth.2fa.session_killed");
  });

  it("concurrent guesses cannot exceed the per-session cap", async () => {
    enrolled();
    const sid = await pendingSession();
    const res = await Promise.all(Array.from({ length: 12 }, () => err(verifySecondFactor(db, deps(), { sid, userId: "u1", code: "111111", kind: "TOTP" }))));
    expect(res.every((e) => e !== null)).toBe(true);
    expect(Number(f.state.userSession.find((s) => s.id === sid)!.twoFactorFailures)).toBeLessThanOrEqual(5);
  });

  it("per-account cap across sessions: a refusing limiter stops the check before any code is evaluated", async () => {
    const secret = enrolled();
    const sid = await pendingSession();
    limit.mockRejectedValue(new HttpError(429, "rate_limited", "Too many requests"));
    expect(await err(verifySecondFactor(db, deps(), { sid, userId: "u1", code: codeAt(secret), kind: "TOTP" }))).toMatchObject({ status: 429 });
    expect(f.state.twoFactorTotp[0]!.lastUsedStep).toBeNull(); // the valid code was not consumed
    expect(f.state.userSession.find((s) => s.id === sid)!.twoFactorFailures).toBe(0);
    limit.mockRejectedValue(new HttpError(503, "limiter_unavailable", "Unavailable"));
    expect(await err(verifySecondFactor(db, deps(), { sid, userId: "u1", code: codeAt(secret), kind: "TOTP" }))).toMatchObject({ status: 503 });
  });

  it("a pending session expires after 10 minutes and a full session cannot use the endpoint", async () => {
    const secret = enrolled();
    const sid = await pendingSession();
    now = new Date(now.getTime() + 10 * 60_000 + 1);
    expect(await err(verifySecondFactor(db, deps(), { sid, userId: "u1", code: codeAt(secret), kind: "TOTP" }))).toMatchObject({ code: "session_ended" });
    now = NOW0;
    const full = await fullSession();
    expect(await err(verifySecondFactor(db, deps(), { sid: full, userId: "u1", code: codeAt(secret), kind: "TOTP" }))).toMatchObject({ code: "session_ended" });
  });

  it("another user's session id is refused", async () => {
    enrolled("u1");
    const sid = await pendingSession("u1");
    expect(await err(verifySecondFactor(db, deps(), { sid, userId: "u2", code: "123456", kind: "TOTP" }))).toMatchObject({ code: "session_ended" });
  });
});

describe("recovery codes (AUT-006, AUT-023)", () => {
  it("are stored hashed, single use, and share the per-session failure counter with TOTP", async () => {
    enrolled();
    const codes = await addRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(JSON.stringify(f.state.recoveryCode)).not.toContain(codes[0]!.replace(/-/g, ""));
    const sid = await pendingSession();
    expect(await err(verifySecondFactor(db, deps(), { sid, userId: "u1", code: "000000", kind: "TOTP" }))).toMatchObject({ code: "invalid_code" });
    const ok = await verifySecondFactor(db, deps(), { sid, userId: "u1", code: codes[0]!.toLowerCase(), kind: "RECOVERY_CODE" });
    expect(ok.method).toBe("RECOVERY_CODE");
    const again = await err(verifySecondFactor(db, deps(), { sid: await pendingSession(), userId: "u1", code: codes[0]!, kind: "RECOVERY_CODE" }));
    expect(again).toMatchObject({ code: "invalid_code" });
    expect(f.state.outboxEvent.some((e) => (e.payload as { kind: string }).kind === "RECOVERY_CODE_USED")).toBe(true);
    expect(f.state.recoveryCode.filter((r) => r.usedAt === null)).toHaveLength(9);
  });

  it("the same unused code cannot be redeemed twice concurrently", async () => {
    enrolled();
    const [c] = await addRecoveryCodes();
    const [a, b] = [await pendingSession(), await pendingSession()];
    const res = await Promise.all([a, b].map((sid) => err(verifySecondFactor(db, deps(), { sid, userId: "u1", code: c!, kind: "RECOVERY_CODE" }))));
    expect(res.filter((e) => e === null)).toHaveLength(1);
  });

  it("a recovery code is refused on the TOTP endpoint shape mismatch (digits only)", async () => {
    enrolled();
    const [c] = await addRecoveryCodes();
    expect(await err(verifySecondFactor(db, deps(), { sid: await pendingSession(), userId: "u1", code: c!, kind: "TOTP" }))).toMatchObject({ code: "invalid_code" });
  });

  it("staff recovery: TOTP row and unused codes removed, other sessions revoked, security-channel event", async () => {
    enrolled("u1", { staff: true });
    const [c] = await addRecoveryCodes();
    const other = await fullSession();
    const sid = await pendingSession();
    const r = await verifySecondFactor(db, deps(), { sid, userId: "u1", code: c!, kind: "RECOVERY_CODE" });
    expect(f.state.twoFactorTotp).toHaveLength(0);
    expect(f.state.recoveryCode.filter((x) => x.usedAt === null)).toHaveLength(0);
    expect(f.state.userSession.find((s) => s.id === other)).toMatchObject({ revokeReason: "recovery_used" });
    expect(f.state.userSession.find((s) => s.id === r.sid)!.revokedAt).toBeNull();
    expect(f.state.outboxEvent.some((e) => (e.payload as { kind: string }).kind === "STAFF_RECOVERY_USED")).toBe(true);
  });
});

describe("enrolment (AUT-005, AUT-021)", () => {
  const verifiedUser = () => f.state.user.push({ id: "u1", email: "u1@x.io", emailVerifiedAt: NOW0, passwordHash: "h:pw" });
  const secretOf = (uri: string) => {
    return base32Decode(new URL(uri).searchParams.get("secret")!);
  };

  it("needs fresh step-up and a verified email", async () => {
    verifiedUser();
    expect(await err(startEnrolment(db, deps(), { userId: "u1", stepUpAt: null }))).toMatchObject({ status: 401, code: "STEP_UP_REQUIRED" });
    f.state.user[0]!.emailVerifiedAt = null;
    expect(await err(startEnrolment(db, deps(), { userId: "u1", stepUpAt: now.getTime() }))).toMatchObject({ status: 403, code: "email_unverified" });
  });

  it("is not enabled until a valid code confirms it; the secret is encrypted at rest and never in audit rows", async () => {
    verifiedUser();
    const sid = await fullSession();
    const { otpauthUri, secret } = await startEnrolment(db, deps(), { userId: "u1", stepUpAt: now.getTime() });
    const raw = secretOf(otpauthUri);
    expect(f.state.twoFactorTotp[0]).toMatchObject({ confirmedAt: null, secretCiphertext: null });
    expect(Buffer.from(f.state.twoFactorTotp[0]!.pendingSecretCiphertext as Uint8Array).includes(raw)).toBe(false);
    expect(await err(confirmEnrolment(db, deps(), { userId: "u1", sid, code: "000000" }))).toMatchObject({ code: "invalid_code" });
    expect(f.state.twoFactorTotp[0]!.confirmedAt).toBeNull();
    const r = await confirmEnrolment(db, deps(), { userId: "u1", sid, code: codeAt(raw) });
    expect(r.recoveryCodes).toHaveLength(10);
    expect(f.state.twoFactorTotp[0]).toMatchObject({ confirmedAt: now, pendingSecretCiphertext: null });
    const everything = JSON.stringify([f.state.auditLog, f.state.outboxEvent]);
    for (const canary of [secret, ...r.recoveryCodes!, codeAt(raw)]) expect(everything).not.toContain(canary);
  });

  it("enrolment race: two confirmations of the same pending secret produce one enablement and one set of recovery codes", async () => {
    verifiedUser();
    const [s1, s2] = [await fullSession(), await fullSession()];
    const { otpauthUri } = await startEnrolment(db, deps(), { userId: "u1", stepUpAt: now.getTime() });
    const code = codeAt(secretOf(otpauthUri));
    const res = await Promise.all([s1, s2].map((sid) => err(confirmEnrolment(db, deps(), { userId: "u1", sid, code }))));
    expect(res.filter((e) => e === null)).toHaveLength(1);
    expect(res.find((e) => e)).toMatchObject({ status: 409 });
    expect(f.state.recoveryCode).toHaveLength(10);
    expect(f.state.auditLog.filter((a) => a.action === "auth.2fa.enabled")).toHaveLength(1);
  });

  it("confirm revokes other sessions and rotates the caller to a verified session (AUT-011)", async () => {
    verifiedUser();
    const [sid, other] = [await fullSession(), await fullSession()];
    const { otpauthUri } = await startEnrolment(db, deps(), { userId: "u1", stepUpAt: now.getTime() });
    const r = await confirmEnrolment(db, deps(), { userId: "u1", sid, code: codeAt(secretOf(otpauthUri)) });
    expect(f.state.userSession.find((s) => s.id === other)).toMatchObject({ revokeReason: "two_factor_changed" });
    expect(f.state.userSession.find((s) => s.id === sid)).toMatchObject({ revokeReason: "rotated", successorId: r.sid });
  });

  it("the pending secret expires after 15 minutes; a replacement keeps the old secret working until confirmed", async () => {
    const old = enrolled();
    const sid = await fullSession();
    expect(await err(startEnrolment(db, deps(), { userId: "u1", stepUpAt: now.getTime() }))).toMatchObject({ code: "code_required" });
    const { otpauthUri } = await startEnrolment(db, deps(), { userId: "u1", stepUpAt: now.getTime(), currentCode: codeAt(old) });
    now = new Date(now.getTime() + 15 * 60_000 + 1);
    expect(await err(confirmEnrolment(db, deps(), { userId: "u1", sid, code: codeAt(secretOf(otpauthUri)) }))).toMatchObject({ code: "no_pending_enrolment" });
    const v = await verifySecondFactor(db, deps(), { sid: await pendingSession(), userId: "u1", code: codeAt(old), kind: "TOTP" });
    expect(v.method).toBe("TOTP"); // old secret still valid
  });
});

describe("step-up, disable, regenerate (AUT-024, AUT-025)", () => {
  const verifyPassword = async (h: string, p: string) => h === `h:${p}`;
  it("needs the password and, when enrolled, a code; every failure is the same error", async () => {
    const secret = enrolled();
    const sid = await fullSession();
    const bad = [{ password: "wrong", code: codeAt(secret) }, { password: "pw" }, { password: "pw", code: "000000" }];
    for (const b of bad) expect(await err(stepUp(db, deps(), { sid, userId: "u1", ...b, verifyPassword }))).toMatchObject({ status: 400, code: "invalid_credentials" });
    await stepUp(db, deps(), { sid, userId: "u1", password: "pw", code: codeAt(secret), verifyPassword });
    expect(f.state.userSession.find((s) => s.id === sid)!.reauthenticatedAt).toEqual(now);
  });

  it("the window is 10 minutes (9:59 ok, 10:01 STEP_UP_REQUIRED)", () => {
    const t = NOW0.getTime();
    expect(() => assertFreshStepUp(t, new Date(t + 9 * 60_000 + 59_000))).not.toThrow();
    expect(() => assertFreshStepUp(t, new Date(t + 10 * 60_000 + 1000))).toThrow(expect.objectContaining({ status: 401, code: "STEP_UP_REQUIRED" }));
    expect(() => assertFreshStepUp(null)).toThrow(expect.objectContaining({ code: "STEP_UP_REQUIRED" }));
  });

  it("disable: step-up required, staff refused with 409, others revoked, afterwards no TOTP row", async () => {
    enrolled();
    const [sid, other] = [await fullSession(), await fullSession()];
    expect(await err(disableTwoFactor(db, deps(), { userId: "u1", sid, stepUpAt: null }))).toMatchObject({ code: "STEP_UP_REQUIRED" });
    await disableTwoFactor(db, deps(), { userId: "u1", sid, stepUpAt: now.getTime() });
    expect(f.state.twoFactorTotp).toHaveLength(0);
    expect(f.state.userSession.find((s) => s.id === other)).toMatchObject({ revokeReason: "two_factor_changed" });
    expect(f.state.outboxEvent.some((e) => (e.payload as { kind: string }).kind === "TWO_FACTOR_DISABLED")).toBe(true);
  });

  it("staff cannot disable 2FA", async () => {
    enrolled("u1", { staff: true });
    expect(await err(disableTwoFactor(db, deps(), { userId: "u1", sid: await fullSession(), stepUpAt: now.getTime() }))).toMatchObject({ status: 409, code: "two_factor_required_by_role" });
    expect(f.state.twoFactorTotp).toHaveLength(1);
  });

  it("regenerate replaces all old codes", async () => {
    enrolled();
    const first = await addRecoveryCodes();
    const second = await addRecoveryCodes();
    expect(f.state.recoveryCode).toHaveLength(10);
    const sid = await pendingSession();
    expect(await err(verifySecondFactor(db, deps(), { sid, userId: "u1", code: first[0]!, kind: "RECOVERY_CODE" }))).toMatchObject({ code: "invalid_code" });
    await verifySecondFactor(db, deps(), { sid, userId: "u1", code: second[0]!, kind: "RECOVERY_CODE" });
  });
});

describe("session lifetimes (AUT-027) and password reset", () => {
  it("staff 2h idle / 12h absolute, users 30d / 90d", async () => {
    for (const [staff, idleMs, absMs] of [[true, 2 * 3600_000, 12 * 3600_000], [false, 30 * 86400_000, 90 * 86400_000]] as const) {
      const id = await createSession(f.db as never, { userId: "u9", pending: false, staff, now });
      const row = f.state.userSession.find((s) => s.id === id) as never;
      expect(sessionVerdict(row, "u9", staff, new Date(now.getTime() + idleMs - 1000))).toBe("ok");
      expect(sessionVerdict(row, "u9", staff, new Date(now.getTime() + idleMs + 1000))).toBe("dead");
      expect((row as { absoluteExpiresAt: Date }).absoluteExpiresAt.getTime() - now.getTime()).toBe(absMs);
    }
  });
  it("rotated sessions can be claimed once, within 60 s, by the same user only", async () => {
    const sid = await pendingSession();
    const row = f.state.userSession.find((s) => s.id === sid)!;
    Object.assign(row, { revokedAt: now, revokeReason: "rotated", successorId: "next" });
    expect(sessionVerdict(row as never, "u1", false, new Date(now.getTime() + 30_000))).toBe("claim_successor");
    expect(sessionVerdict(row as never, "u1", false, new Date(now.getTime() + 61_000))).toBe("dead");
    expect(sessionVerdict(row as never, "u2", false, now)).toBe("dead");
    row.successorClaimedAt = now;
    expect(sessionVerdict(row as never, "u1", false, now)).toBe("dead");
  });
  it("no password-reset code path touches the 2FA tables (password reset must not disable 2FA)", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const dir = new URL(".", import.meta.url);
    const offenders = readdirSync(dir).filter((n) => /reset|password/i.test(n) && n.endsWith(".ts") && !n.endsWith(".test.ts"))
      .filter((n) => /twoFactorTotp|recoveryCode/.test(readFileSync(new URL(n, dir), "utf8")));
    expect(offenders).toEqual([]);
  });
});

// ---- M3b gate (task #63): AUT-013 canaries, AUT-022 alert ----
describe("AUT-013: canaries never reach console output", () => {
  it("TOTP secret, code, recovery code and session ids are not written to the console by verify, failure or recovery flows", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    try {
      const secret = enrolled();
      const codes = (await addRecoveryCodes()) ?? [];
      const sid = await pendingSession();
      const ok = await verifySecondFactor(db, deps(), { sid, userId: "u1", code: codeAt(secret), kind: "TOTP" });
      const sid2 = await pendingSession();
      await err(verifySecondFactor(db, deps(), { sid: sid2, userId: "u1", code: "000000", kind: "TOTP" }));
      const sid3 = await pendingSession();
      await verifySecondFactor(db, deps(), { sid: sid3, userId: "u1", code: codes[0]!, kind: "RECOVERY_CODE" });
      const logged = JSON.stringify(spies.map((s) => s.mock.calls));
      for (const canary of [secret.toString("base64"), secret.toString("hex"), codeAt(secret), codes[0]!, ok.sid]) expect(logged).not.toContain(canary);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("AUT-022: SECOND_FACTOR_FAILURES alert", () => {
  const alerts = () => f.state.outboxEvent.filter((e) => (e as { payload?: { kind?: string } }).payload?.kind === "SECOND_FACTOR_FAILURES");
  it("three failures on one pending session after the password raise exactly one SECOND_FACTOR_FAILURES alert", async () => {
    enrolled();
    const sid = await pendingSession();
    for (let i = 0; i < 3; i++) await err(verifySecondFactor(db, deps(), { sid, userId: "u1", code: "000000", kind: "TOTP" }));
    expect(alerts()).toHaveLength(1);
    await err(verifySecondFactor(db, deps(), { sid, userId: "u1", code: "000000", kind: "TOTP" }));
    expect(alerts()).toHaveLength(1);
  });
  it("AUT-022: the alert is limited to one per account per hour, not one per session (QA-M3B-06)", async () => {
    enrolled();
    for (let s = 0; s < 2; s++) {
      const sid = await pendingSession();
      for (let i = 0; i < 3; i++) await err(verifySecondFactor(db, deps(), { sid, userId: "u1", code: "000000", kind: "TOTP" }));
    }
    expect(alerts()).toHaveLength(1);
  });
  it("SEC-M3B-02: parallel wrong codes across sessions still raise exactly one alert", async () => {
    enrolled();
    const sids = [await pendingSession(), await pendingSession(), await pendingSession()];
    await Promise.all(sids.flatMap((sid) => [1, 2, 3, 4].map(() => err(verifySecondFactor(db, deps(), { sid, userId: "u1", code: "000000", kind: "TOTP" })))));
    expect(alerts()).toHaveLength(1);
  });
});
