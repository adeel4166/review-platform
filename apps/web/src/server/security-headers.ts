/** Security response headers + nonce CSP. Edge-safe. Used by src/middleware.ts. */
export function storageOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT ?? "";
  try {
    return raw ? new URL(raw).origin : "";
  } catch {
    return "";
  }
}

export function buildCsp(nonce: string, opts: { dev?: boolean; storage?: string } = {}): string {
  const dev = opts.dev ?? process.env.NODE_ENV !== "production";
  const storage = [opts.storage ?? storageOrigin(), process.env.MEDIA_PUBLIC_STORE === "cloudinary" ? "https://res.cloudinary.com" : ""].filter(Boolean).join(" ");
  const media = ["'self'", storage, "data:", "blob:"].filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets nonce'd Next scripts load their chunks; dev needs eval for React refresh.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`, // Tailwind/Next inline styles; scripts are the XSS-critical part
    `img-src ${media}`,
    `media-src 'self' ${storage}`.trim(),
    `connect-src 'self' ${storage}${dev ? " ws: wss:" : ""}`.trim(),
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders(nonce: string, pathname = "/"): Record<string, string> {
  return {
    "Content-Security-Policy": buildCsp(nonce),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": pathname.startsWith("/api/media") || pathname.includes("/media") ? "no-referrer" : "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  };
}
