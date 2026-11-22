import { systemClock } from "@rp/core";
import { db } from "@/server/db";
import { HttpError, handle, json, readJson } from "@/server/http";
import { requireUser } from "@/server/session";
import { revokeOtherSessions } from "@/server/user-sessions";

export const runtime = "nodejs";

/** Signs out every other session of the caller (m3b-spec 2.4). */
export function POST(req: Request) {
  return handle(async () => {
    await readJson(req).catch(() => undefined);
    const a = await requireUser();
    if (!a.sid) throw new HttpError(401, "unauthenticated", "Sign in required");
    const count = await revokeOtherSessions(db, a.id, a.sid, "revoke_others", systemClock.now());
    return json({ revoked: count });
  });
}
