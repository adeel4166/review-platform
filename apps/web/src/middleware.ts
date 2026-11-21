import { NextResponse, type NextRequest } from "next/server";
import { isCrossOrigin } from "./server/origin";
import { securityHeaders } from "./server/security-headers";

function nonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // Auth.js callbacks are exempt from nothing here: all mutating cross-site requests are refused.
  if (isCrossOrigin(req)) {
    const res = NextResponse.json({ error: { code: "cross_origin", message: "Cross-origin request rejected" } }, { status: 403 });
    for (const [k, v] of Object.entries(securityHeaders(nonce(), pathname))) res.headers.set(k, v);
    return res;
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
