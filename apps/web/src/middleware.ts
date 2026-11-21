import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { isCrossOrigin } from "./server/origin";
import { pendingDecision } from "./server/pending-gate";
import { securityHeaders } from "./server/security-headers";

function nonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // Auth.js callbacks are exempt from nothing here: all mutating cross-site requests are refused.
  if (isCrossOrigin(req)) {
    const res = NextResponse.json({ error: { code: "cross_origin", message: "Cross-origin request rejected" } }, { status: 403 });
    for (const [k, v] of Object.entries(securityHeaders(nonce(), pathname))) res.headers.set(k, v);
    return res;
  }

  // Pending-2FA gate (UX layer; the session callback and requirePendingSession are the security controls). The `pnd`
  // claim is re-derived from the database by the jwt callback, never from client input.
  const secret = process.env.AUTH_SECRET;
  if (secret && !pathname.startsWith("/_next/")) {
    let pending = false;
    for (const secureCookie of [true, false]) {
      const t = await getToken({ req, secret, secureCookie }).catch(() => null);
      if (t) { pending = t.pnd === true; break; }
    }
    if (pending) {
      const d = pendingDecision(pathname);
      if (d !== "allow") {
        const res = d === "deny"
          ? NextResponse.json({ error: { code: "second_factor_pending", message: "Second factor required" } }, { status: 401 })
          : NextResponse.redirect(new URL("/login/2fa", req.url));
        for (const [k, v] of Object.entries(securityHeaders(nonce(), pathname))) res.headers.set(k, v);
        return res;
      }
    }
  }

  const n = nonce();
  const headers = securityHeaders(n, pathname);
  const reqHeaders = new Headers(req.headers);
  if (!isApi) {
    reqHeaders.set("x-nonce", n);
    reqHeaders.set("content-security-policy", headers["Content-Security-Policy"]!); // Next reads the nonce from this
  }
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
