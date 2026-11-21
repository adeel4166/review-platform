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

let dummyHash: Promise<string> | undefined;

export async function authorizeCredentials(raw: unknown) {
  const parsed = loginInput.safeParse(raw);
  if (!parsed.success) return null;
  const user = await db.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true, displayName: true, passwordHash: true, status: true, roles: { select: { role: true } } },
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
  return { id: user.id, email: user.email, name: user.displayName };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  providers: [Credentials({ credentials: { email: {}, password: {} }, authorize: authorizeCredentials })],
  callbacks: {
    // Runs on every session read: re-check the account so bans/role changes apply immediately (ADR-0002 req. 1).
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      if (!token.sub) return null;
      const u = await db.user.findUnique({
        where: { id: token.sub },
        select: { status: true, roles: { select: { role: true } } },
      });
      if (!u || u.status !== "ACTIVE") return null;
      token.role = roleFrom(u.roles);
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub as string;
      session.user.role = (token.role as AppRole) ?? "user";
      return session;
    },
  },
});
