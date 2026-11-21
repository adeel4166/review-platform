import type { Db } from "./db";
import { db as defaultDb } from "./db";
import { HttpError } from "./http";
import { requireUser, type Actor } from "./session";

/**
 * Guard for seller creation, ownership claims and invitations (ADR-0016 §2). Reads `emailVerifiedAt` from the database
 * on every call (not the JWT), so verifying in another tab unblocks the next request.
 */
export async function requireVerifiedUser(db: Pick<Db, "user"> = defaultDb): Promise<Actor> {
  const actor = await requireUser();
  const u = await db.user.findUnique({ where: { id: actor.id }, select: { emailVerifiedAt: true } });
  if (!u?.emailVerifiedAt) throw new HttpError(403, "EMAIL_NOT_VERIFIED", "Verify your email address first");
  return actor;
}
