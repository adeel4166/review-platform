import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/session", async () => {
  const { HttpError } = await import("@/server/http");
  return { requireUser: vi.fn(async () => { throw new HttpError(401, "unauthenticated", "Sign in required"); }) };
});
vi.mock("@/server/db", () => ({ db: {} }));

import { middleware } from "../middleware";
import { POST as register } from "../app/api/auth/register/route";
import { buildCsp } from "./security-headers";

const mk = (path: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) => new NextRequest(`http://app.test${path}`, init);

describe("security headers", () => {
  for (const path of ["/products/abc", "/api/health"]) {
    it(`middleware sets headers on ${path}`, async () => {
      const res = await middleware(mk(path));
      const csp = res.headers.get("content-security-policy")!;
      expect(csp).toMatch(/default-src 'self'/);
      expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("permissions-policy")).toContain("camera=()");
    });
  }
  it("includes the storage origin in img-src and no unsafe-eval in production", async () => {
    const csp = buildCsp("n", { dev: false, storage: "https://cdn.example.com" });
    expect(csp).toMatch(/img-src 'self' https:\/\/cdn\.example\.com data:/);
    expect(csp).not.toContain("unsafe-eval");
  });
  it("uses a fresh nonce per request", async () => {
    const n = (r: Response) => r.headers.get("content-security-policy")!.match(/nonce-([^']+)/)![1];
    expect(n(await middleware(mk("/")))).not.toBe(n(await middleware(mk("/"))));
  });
});

describe("request origin / content-type checks", () => {
  const body = JSON.stringify({});
  it("middleware rejects a cross-origin POST", async () => {
    const res = await middleware(mk("/api/products/x/reviews", { method: "POST", body, headers: { origin: "https://evil.test", "content-type": "application/json" } }));
    expect(res.status).toBe(403);
  });
  it("middleware rejects Sec-Fetch-Site: cross-site", async () => {
    expect((await middleware(mk("/api/x", { method: "POST", body, headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);
  });
  it("middleware allows same-origin POST and GETs from anywhere", async () => {
    expect((await middleware(mk("/api/x", { method: "POST", body, headers: { origin: "http://app.test", "sec-fetch-site": "same-origin" } }))).status).toBe(200);
    expect((await middleware(mk("/api/x", { headers: { origin: "https://evil.test" } }))).status).toBe(200);
  });
  it("route rejects a cross-origin POST even if middleware is bypassed", async () => {
    const r = new Request("http://app.test/api", { method: "POST", body, headers: { origin: "https://evil.test", "content-type": "application/json" } });
    expect((await register(r)).status).toBe(403);
  });
  it("route rejects a non-JSON POST with 415", async () => {
    const r = new Request("http://app.test/api", { method: "POST", body: "a=b", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect((await register(r)).status).toBe(415);
  });
});
