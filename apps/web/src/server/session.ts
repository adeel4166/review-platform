import { auth, type AppRole } from "./auth";
import { HttpError } from "./http";

export interface Actor { id: string; role: AppRole }

/** Resolves the authenticated actor or throws 401. Routes import this (not Auth.js) so tests can mock it. */
export async function requireUser(): Promise<Actor> {
  const s = await auth();
  if (!s?.user?.id) throw new HttpError(401, "unauthenticated", "Sign in required");
  return { id: s.user.id, role: s.user.role };
}
