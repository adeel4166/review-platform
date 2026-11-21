import { EMAIL_TOKEN_TTL_MS } from "@rp/core";
import { HttpError } from "./http";
import type { RegisterInput } from "./validation";

export interface RegisterDb {
  user: { findUnique(a: unknown): Promise<{ id: string } | null> };
  $transaction<T>(fn: (tx: RegisterTx) => Promise<T>): Promise<T>;
}
interface RegisterTx {
  user: { findUnique(a: unknown): Promise<{ id: string } | null>; create(a: unknown): Promise<{ id: string }> };
  emailVerificationToken: { create(a: unknown): Promise<{ id: string }> };
  outboxEvent: { create(a: unknown): Promise<unknown> };
}

export const REGISTER_RESPONSE = { status: "verification_sent" } as const;
const uniqueTarget = (e: unknown): string | undefined => {
  if ((e as { code?: string } | null)?.code !== "P2002") return undefined;
  const t = (e as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(t) ? t.join(",") : String(t ?? "");
};

/**
 * SEC-05 / ADR-0016 §3.2. Same status and body whether or not the email exists. The password is hashed on every path
 * and mail is sent by the worker, so neither argon2 nor SMTP latency distinguishes the cases.
 */
export async function registerAccount(db: RegisterDb, input: RegisterInput, hash: (pw: string) => Promise<string>, now = new Date()) {
  // Handles are public (profile URLs), so a handle conflict is not an email oracle.
  if (await db.user.findUnique({ where: { handle: input.handle }, select: { id: true } })) throw new HttpError(409, "handle_taken", "That handle is already taken");
  const passwordHash = await hash(input.password);
  const conflict = (tx: RegisterTx, userId: string) => tx.outboxEvent.create({ data: { type: "user.registration_conflict", aggregateId: userId, payload: { userId } } });
  const attempt = () => db.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existing) return void (await conflict(tx, existing.id));
    const user = await tx.user.create({ data: { email: input.email, handle: input.handle, displayName: input.displayName, passwordHash }, select: { id: true } });
    const token = await tx.emailVerificationToken.create({
      data: { userId: user.id, purpose: "ACCOUNT_EMAIL", email: input.email, expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS) },
      select: { id: true },
    });
    await tx.outboxEvent.create({ data: { type: "user.email_verification_requested", aggregateId: user.id, payload: { tokenId: token.id } } });
  });
  try {
    await attempt();
  } catch (e) {
    const target = uniqueTarget(e);
    if (target === undefined) throw e;
    if (/handle/.test(target)) throw new HttpError(409, "handle_taken", "That handle is already taken");
    await attempt(); // email race: the account now exists, so this takes the "known" path
  }
  return REGISTER_RESPONSE;
}
