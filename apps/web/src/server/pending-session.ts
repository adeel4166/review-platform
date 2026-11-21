import { getToken } from "next-auth/jwt";
import { refreshJwt } from "./auth";
import { HttpError } from "./http";

/**
 * The ONLY reader of pending-2FA sessions (m3b-spec 2.3 layer 2). Imported solely by /api/auth/2fa/verify and
 * /api/auth/2fa/recovery; a CI test (two-factor-gate.test.ts) fails if any other module imports it.
 * Everything else sees a pending session as "not signed in" because the session callback hides its user.
 */
export async function requirePendingSession(req: Request): Promise<{ sid: string; userId: string }> {
  const secret = process.env.AUTH_SECRET;
  const denied = () => new HttpError(401, "unauthenticated", "Sign in required");
  if (!secret) throw denied();
  for (const secure of [true, false]) {
    const token = await getToken({ req, secret, secureCookie: secure }).catch(() => null);
    if (!token) continue;
    const t = await refreshJwt({ ...token } as Parameters<typeof refreshJwt>[0]);
    if (t && t.pnd === true && typeof t.sid === "string" && typeof t.sub === "string") return { sid: t.sid, userId: t.sub };
    throw denied(); // a full session has nothing to do at the second-factor endpoints
  }
  throw denied();
}
