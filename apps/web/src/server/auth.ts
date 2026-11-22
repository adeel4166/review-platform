import { systemClock } from "@rp/core";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { hashPassword, verifyPassword } from "@rp/db";
import { db } from "./db";
import { loginInput } from "./validation";
import { claimSuccessor, createSession, sessionVerdict, TOUCH_INTERVAL_MS } from "./user-sessions";

export type AppRole = "user" | "moderator" | "senior_moderator" | "admin" | "super_admin";

declare module "next-auth" {
  interface Session {
    /** Absent for a pending-2FA session: the user of a half-authenticated session is invisible to every reader (AZ-009). */
    user: { id: string; role: AppRole; sid: string; twoFactor: { enrolled: boolean; verified: boolean }; stepUpAt: number | null } & DefaultSession["user"];
    pending?: true;
  }
}

/** ADR-0003: SUPER_ADMIN > ADMIN > user (no implicit inheritance in the DB; this collapses to the highest admin tier). */
export function roleFrom(roles: { role: string }[]): AppRole {
  if (roles.some((r) => r.role === "SUPER_ADMIN")) return "super_admin";
  if (roles.some((r) => r.role === "ADMIN")) return "admin";
  if (roles.some((r) => r.role === "SENIOR_MODERATOR")) return "senior_moderator";
  return roles.some((r) => r.role === "MODERATOR") ? "moderator" : "user";
}

/** Session version of an account: 0 while unverified, otherwise the verification time (ms). */
export const sessionVersion = (emailVerifiedAt: Date | null | undefined): number => emailVerifiedAt?.getTime() ?? 0;

let dummyHash: Promise<string> | undefined;

export async function authorizeCredentials(raw: unknown) {
  const parsed = loginInput.safeParse(raw);
  if (!parsed.success) return null;
  const user = await db.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true, displayName: true, passwordHash: true, status: true, emailVerifiedAt: true, roles: { select: { role: true } } },
  });
  if (!user?.passwordHash) {
    // Equalise timing so unknown emails are not distinguishable from wrong passwords.
    dummyHash ??= hashPassword("not-a-real-password");
    await verifyPassword(await dummyHash, parsed.data.password);
    return null;
  }
  if (!(await verifyPassword(user.passwordHash, parsed.data.password))) return null;
  if (user.status !== "ACTIVE") return null;
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: systemClock.now() } });
  return { id: user.id, email: user.email, name: user.displayName, sessionVersion: sessionVersion(user.emailVerifiedAt) };
}

/** Claims carried by the JWT. Only `sub`, `sid` and `sv` are identity; the rest is re-derived from the database on every read. */
interface Claims { sub?: string; sv?: unknown; sid?: unknown; role?: unknown; pnd?: unknown; tfe?: unknown; tfv?: unknown; su?: unknown }

/**
 * Runs on every session read. Never copies anything from a client-supplied `session` argument (Auth.js `trigger: "update"`
 * payloads are attacker-controlled): sid, pending and role come only from the database (m3b-spec 2.1, AUT-019).
 */
export async function refreshJwt<T extends Claims>(token: T, user?: { id?: string; sessionVersion?: number }, now = systemClock.now()): Promise<T | null> {
  const signingIn = !!user?.id;
  if (user?.id) {
    token.sub = user.id;
    token.sv = user.sessionVersion ?? 0;
    delete token.sid;
  }
  if (!token.sub) return null;
  const u = await db.user.findUnique({
    where: { id: token.sub },
    select: { status: true, emailVerifiedAt: true, roles: { select: { role: true } } },
  });
  if (!u || u.status !== "ACTIVE") return null;
  // T-02: the session version is the verification time. A session created before the email was verified (sv 0 or older)
  // is rejected, so a pre-registering attacker loses access when the victim verifies.
  if (sessionVersion(u.emailVerifiedAt) !== ((token.sv as number | undefined) ?? 0)) return null;
  const staff = u.roles.length > 0;
  const totp = await db.twoFactorTotp.findUnique({ where: { userId: token.sub }, select: { confirmedAt: true } });
  const enrolled = !!totp?.confirmedAt;
  if (signingIn) token.sid = await createSession(db, { userId: token.sub, pending: enrolled, staff, now });
  if (typeof token.sid !== "string") return null; // pre-M3b JWT without a session row
  let row = await db.userSession.findUnique({ where: { id: token.sid } });
  let verdict = sessionVerdict(row, token.sub, staff, now);
  if (verdict === "claim_successor" && row) {
    const next = await claimSuccessor(db, row, now);
    if (!next) return null;
    token.sid = next;
    row = await db.userSession.findUnique({ where: { id: next } });
    verdict = sessionVerdict(row, token.sub, staff, now);
  }
  if (verdict !== "ok" || !row) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) await db.userSession.update({ where: { id: row.id }, data: { lastSeenAt: now } });
  token.role = roleFrom(u.roles);
  token.pnd = row.secondFactorPending;
  token.tfe = enrolled;
  token.tfv = !!row.secondFactorVerifiedAt;
  token.su = row.reauthenticatedAt?.getTime() ?? null;
  return token;
}

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 90 },
  pages: { signIn: "/login" },
  providers: [Credentials({ credentials: { email: {}, password: {} }, authorize: authorizeCredentials })],
  callbacks: {
    // Runs on every session read: re-check the account so bans/role changes apply immediately (ADR-0002 req. 1).
    // Only `token` and the sign-in `user` are read: the `session` argument of an "update" trigger is client-controlled.
    jwt: ({ token, user }) => refreshJwt(token, user as { id?: string; sessionVersion?: number } | undefined),
    session({ session, token }) {
      if (token.pnd) return { expires: session.expires, pending: true } as unknown as typeof session;
      session.user.id = token.sub as string;
      session.user.role = (token.role as AppRole) ?? "user";
      session.user.sid = token.sid as string;
      session.user.twoFactor = { enrolled: token.tfe === true, verified: token.tfv === true };
      session.user.stepUpAt = typeof token.su === "number" ? token.su : null;
      return session;
    },
  },
});

/** Re-runs the jwt callback so the browser's cookie swaps to the rotated session (m3b-spec 2.4). Carries no client data. */
export async function rotateCookie(): Promise<void> {
  await unstable_update({});
}
