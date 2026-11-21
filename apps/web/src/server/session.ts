import { auth, type AppRole } from "./auth";
import { HttpError } from "./http";

export interface Actor { id: string; role: AppRole }

/** Resolves the authenticated actor or throws 401. Routes import this (not Auth.js) so tests can mock it. */
export async function requireUser(): Promise<Actor> {
  const s = await auth();
  // Fail closed: an error-populated session object (e.g. { error: ... }) or a missing/blank id is never authenticated.
  const id = s?.user?.id;
  if (!s || "error" in s || typeof id !== "string" || id.trim() === "") {
    throw new HttpError(401, "unauthenticated", "Sign in required");
  }
  return { id, role: s.user.role };
}

/** Admin-only gate: 401 when signed out, 403 for non-admins. */
export async function requireAdmin(): Promise<Actor> {
  const a = await requireUser();
  if (a.role !== "admin") throw new HttpError(403, "forbidden", "Admin access required");
  return a;
}
