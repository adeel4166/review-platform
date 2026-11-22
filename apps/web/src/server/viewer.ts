import { auth } from "./auth";

/** Signed-in viewer id for public reads (block checks), or null for anonymous. Never throws. */
export async function optionalUserId(): Promise<string | null> {
  try { const s = await auth(); const id = s && !("error" in s) && !(s as { pending?: unknown }).pending ? s.user?.id : null; return typeof id === "string" && id ? id : null; } catch { return null; }
}
