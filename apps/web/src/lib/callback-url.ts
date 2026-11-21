/**
 * Post-login redirect target (SEC-13). Only same-origin relative paths are accepted; anything else
 * (absolute URLs, protocol-relative `//host`, backslash tricks, control characters) falls back to "/".
 */
export function safeCallbackUrl(raw: string | string[] | null | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string" || v.length === 0 || v.length > 2048) return "/";
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\")) return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) return "/";
  try {
    const base = "http://callback.invalid";
    const u = new URL(v, base);
    if (u.origin !== base) return "/";
    if (u.pathname.startsWith("/login") || u.pathname.startsWith("/register")) return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}
