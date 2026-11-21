/** Default-deny routing for a pending-2FA session (m3b-spec 2.3 layers 1 and 3). Edge-safe: no Node or DB imports. */

/** The only paths a half-authenticated browser may reach. Everything else is denied unless listed here. */
const PENDING_ALLOW: readonly (string | RegExp)[] = [
  "/api/auth/2fa/verify",
  "/api/auth/2fa/recovery",
  /^\/api\/auth\/(session|csrf|signout|providers)$/, // Auth.js: sign out and read the {pending:true} marker
  "/login",
  "/login/2fa",
  "/api/health",
];

export type PendingDecision = "allow" | "redirect" | "deny";

/** For a request carrying a pending JWT: pages redirect to /login/2fa, API calls get 401, nothing else gets through. */
export function pendingDecision(pathname: string): PendingDecision {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (PENDING_ALLOW.some((a) => (typeof a === "string" ? a === p : a.test(p)))) return "allow";
  return p.startsWith("/api/") ? "deny" : "redirect";
}
