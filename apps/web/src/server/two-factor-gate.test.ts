import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real session helpers and real route handlers; only Auth.js, the DB and Redis are replaced.
const authMock = vi.fn();
vi.mock("@/server/auth", () => ({ auth: () => authMock(), rotateCookie: async () => undefined, refreshJwt: async () => null }));
vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("next-auth/jwt", () => ({ getToken: async () => null }));

import { pendingDecision } from "./pending-gate";
import { requireAdmin, requireStepUp, requireSuperAdmin, requireTwoFactor, requireUser } from "./session";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const API = join(SRC, "app/api");
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const routes = walk(API).filter((f) => f.endsWith("/route.ts")).map((f) => relative(API, f));
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const exported = (file: string) => METHODS.filter((m) => new RegExp(`export (async function ${m}\\b|const ${m}\\b|function ${m}\\b)`).test(readFileSync(join(API, file), "utf8")));

/** Routes that are deliberately reachable without a session. Anything else MUST deny a pending session. */
const PUBLIC = new Set([
  "health/route.ts:GET", "auth/register/route.ts:POST", "auth/verify-email/route.ts:POST", "auth/verify-email/route.ts:GET",
  "auth/verify-email/status/route.ts:GET", // answers `{unverified:false}` exactly as for an anonymous caller: a pending session has no visible user
  "ownership-transfers/cancel-by-link/route.ts:POST", // cancel link: the unused token is the credential (m3b-spec 3.4)
  "claims/email-verify/deny/route.ts:POST", // mailbox holder's veto link (m3b-spec 4.4)
  "products/route.ts:GET", "products/[id]/route.ts:GET", "products/[id]/reviews/route.ts:GET",
  // M7 public reads (content.read.public): viewer id is optional and only used for block checks
  "compare/route.ts:GET", "users/[handle]/route.ts:GET", "users/[handle]/reviews/route.ts:GET", "users/[handle]/followers/route.ts:GET", "users/[handle]/following/route.ts:GET",
]);
/** Handled by Auth.js itself (sign out / session marker / credentials sign-in). */
const AUTHJS = new Set(["auth/[...nextauth]/route.ts:GET", "auth/[...nextauth]/route.ts:POST"]);

const PARAMS = { id: "x", sellerId: "x", userId: "x", slug: "x" };
const call = async (file: string, method: string) => {
  const mod = (await import(`../app/api/${file.replace(/\/route\.ts$/, "")}/route`)) as Record<string, (r: Request, c: unknown) => Promise<Response>>;
  const req = new Request("http://app.test/api/x", { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
  return mod[method]!(req, { params: Promise.resolve(PARAMS) });
};

describe("AZ-009: a pending-2FA session is denied by every protected route", () => {
  beforeEach(() => {
    authMock.mockReset();
    // DEF-LIVE-04: these cases only assert the guard outcome; a handler that passes the guard then hits the (absent) DB and logs
    // "unhandled route error" via http.ts handle(). That log (plus the ioredis/ratelimit backend-down notices, no Redis in unit tests) is expected here; any other console.error still surfaces.
    const real = console.error.bind(console);
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      if (!/^(unhandled route error|\[ioredis\]|\{"msg":"ratelimit\.error")/.test(String(a[0]))) real(...a);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("discovers the route registry (guards against an empty sweep)", () => {
    expect(routes.length).toBeGreaterThan(30);
    expect(routes).toContain("auth/2fa/verify/route.ts");
  });

  for (const file of routes) {
    for (const method of exported(file)) {
      const id = `${file}:${method}`;
      if (AUTHJS.has(id)) continue;
      it(`${id}`, async () => {
        authMock.mockResolvedValue({ pending: true, expires: "2099-01-01" }); // what the session callback returns for a pending row
        const res = await call(file, method);
        if (PUBLIC.has(id)) {
          expect(res.status).not.toBe(401);
        } else {
          expect(res.status, `${id} must deny a pending session`).toBe(401);
          expect(["second_factor_pending", "unauthenticated"]).toContain(((await res.json()) as { error: { code: string } }).error.code);
        }
      });
    }
  }

  it("requireUser/requireAdmin/requireSuperAdmin refuse a pending session with second_factor_pending", async () => {
    authMock.mockResolvedValue({ pending: true, expires: "x" });
    for (const g of [requireUser, requireAdmin, requireSuperAdmin]) await expect(g()).rejects.toMatchObject({ status: 401, code: "second_factor_pending" });
  });

  it("only the two 2FA endpoints import requirePendingSession", () => {
    const importers = walk(SRC).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts") && /import\s*\{[^}]*requirePendingSession[^}]*\}/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f)).sort();
    expect(importers).toEqual(["server/two-factor-routes.ts"]);
    const callers = routes.filter((r) => readFileSync(join(API, r), "utf8").includes("verifyRoute")).sort();
    expect(callers).toEqual(["auth/2fa/recovery/route.ts", "auth/2fa/verify/route.ts"]);
  });
});

describe("AZ-008/AZ-027: staff gate and step-up", () => {
  const staff = (twoFactor?: { enrolled: boolean; verified: boolean }, role = "admin") => authMock.mockResolvedValue({ user: { id: "a", role, sid: "s", twoFactor, stepUpAt: null } });
  it.each([undefined, { enrolled: false, verified: false }, { enrolled: true, verified: false }, { enrolled: false, verified: true }])("staff without enrolled+verified 2FA gets 403 TWO_FACTOR_REQUIRED (%j)", async (tf) => {
    staff(tf);
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403, code: "TWO_FACTOR_REQUIRED" });
    staff(tf, "super_admin");
    await expect(requireSuperAdmin()).rejects.toMatchObject({ status: 403, code: "TWO_FACTOR_REQUIRED" });
  });
  it("a verified, enrolled admin passes; requireStepUp then demands a fresh re-authentication", async () => {
    staff({ enrolled: true, verified: true });
    const a = await requireAdmin();
    expect(() => requireStepUp(a)).toThrow(expect.objectContaining({ status: 401, code: "STEP_UP_REQUIRED" }));
    expect(() => requireStepUp({ ...a, stepUpAt: Date.now() - 60_000 })).not.toThrow();
    expect(() => requireStepUp({ ...a, stepUpAt: Date.now() - 11 * 60_000 })).toThrow();
    expect(() => requireTwoFactor({ id: "a", role: "user" })).toThrow();
  });
  it("every /api/admin route handler is gated by requireAdmin or requireSuperAdmin", () => {
    for (const r of routes.filter((x) => x.startsWith("admin/"))) expect(readFileSync(join(API, r), "utf8")).toMatch(/requireAdmin|requireSuperAdmin/);
  });
});

describe("middleware pending gate (default deny)", () => {
  it("allows only the 2FA endpoints, Auth.js sign-out/session and the login pages", () => {
    for (const p of ["/api/auth/2fa/verify", "/api/auth/2fa/recovery", "/api/auth/session", "/api/auth/signout", "/login", "/login/2fa", "/api/health"]) expect(pendingDecision(p)).toBe("allow");
  });
  it.each(["/api/account/2fa", "/api/auth/step-up", "/api/admin/audit", "/api/products", "/api/auth/callback/credentials", "/api/auth/2fa/verify/extra", "/api/auth/2fa/../step-up"])("denies API %s", (p) => expect(pendingDecision(p)).toBe("deny"));
  it.each(["/", "/admin/moderation", "/seller/1", "/products/a"])("redirects page %s", (p) => expect(pendingDecision(p)).toBe("redirect"));
});
