/** CSRF defence-in-depth for cookie-authenticated mutating requests. Edge-safe (no Node imports). */
export const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Returns true when a mutating request is demonstrably cross-site. Non-browser clients (no headers) pass. */
export function isCrossOrigin(req: Request): boolean {
  if (!MUTATING.has(req.method.toUpperCase())) return false;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
    try {
      if (new URL(origin).host !== host) return true;
    } catch {
      return true; // e.g. "null" origin
    }
  }
  return false;
}
