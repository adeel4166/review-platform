import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { hashPassword, verifyPassword } from "@rp/db";
import { db } from "./db";
import { loginInput } from "./validation";

export type AppRole = "user" | "admin" | "super_admin";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: AppRole } & DefaultSession["user"];
  }
}

/** ADR-0003: SUPER_ADMIN > ADMIN > user (no implicit inheritance in the DB; this collapses to the highest admin tier). */
export function roleFrom(roles: { role: string }[]): AppRole {
  if (roles.some((r) => r.role === "SUPER_ADMIN")) return "super_admin";
  return roles.some((r) => r.role === "ADMIN") ? "admin" : "user";
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
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { id: user.id, email: user.email, name: user.displayName, sessionVersion: sessionVersion(user.emailVerifiedAt) };
}

export async function refreshJwt<T extends { sub?: string; sv?: unknown; role?: unknown }>(token: T, user?: { id?: string; sessionVersion?: number }): Promise<T | null> {
  if (user?.id) {
    token.sub = user.id;
    token.sv = user.sessionVersion ?? 0;
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
  token.role = roleFrom(u.roles);
  return token;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  providers: [Credentials({ credentials: { email: {}, password: {} }, authorize: authorizeCredentials })],
  callbacks: {
    // Runs on every session read: re-check the account so bans/role changes apply immediately (ADR-0002 req. 1).
    jwt: ({ token, user }) => refreshJwt(token, user as { id?: string; sessionVersion?: number } | undefined),
    session({ session, token }) {
      session.user.id = token.sub as string;
      session.user.role = (token.role as AppRole) ?? "user";
      return session;
    },
  },
});
