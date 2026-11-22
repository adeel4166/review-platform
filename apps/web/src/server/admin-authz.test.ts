import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real requireUser/requireAdmin run; only the Auth.js call and the DB are replaced.
const authMock = vi.fn();
vi.mock("@/server/auth", () => ({ auth: () => authMock() }));
vi.mock("@/server/db", () => ({ db: {} }));

const ADMIN_DIR = fileURLToPath(new URL("../app/api/admin", import.meta.url));

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface AdminRoute { file: string; method: Method; withId: boolean; superOnly?: boolean }

/** Every /api/admin/* route handler. The discovery test below fails if a route file is missing from this table. */
const ADMIN_ROUTES: AdminRoute[] = [
  { file: "audit/route.ts", method: "GET", withId: false },
  { file: "approvals/route.ts", method: "GET", withId: false },
  { file: "appeals/route.ts", method: "GET", withId: false },
  { file: "appeals/[id]/claim/route.ts", method: "POST", withId: true },
  { file: "appeals/[id]/decide/route.ts", method: "POST", withId: true },
  { file: "approvals/[id]/approve/route.ts", method: "POST", withId: true },
  { file: "approvals/[id]/reject/route.ts", method: "POST", withId: true },
  { file: "approvals/[id]/cancel/route.ts", method: "POST", withId: true },
  { file: "users/[id]/2fa-reset-requests/route.ts", method: "POST", withId: true },
  { file: "config/moderation/[version]/activation-requests/route.ts", method: "POST", withId: true },
  { file: "proofs/[proofId]/files/[fileId]/original-access/route.ts", method: "POST", withId: true },
  { file: "break-glass/[accessId]/content/route.ts", method: "GET", withId: true },
  { file: "moderation/route.ts", method: "GET", withId: false },
  { file: "moderation/[id]/route.ts", method: "GET", withId: true },
  { file: "moderation/[id]/approve/route.ts", method: "POST", withId: true },
  { file: "moderation/[id]/reject/route.ts", method: "POST", withId: true },
  { file: "claims/route.ts", method: "GET", withId: false },
  { file: "claims/[id]/route.ts", method: "GET", withId: true },
  { file: "claims/[id]/decision/route.ts", method: "POST", withId: true },
  { file: "sellers/[id]/suspend/route.ts", method: "POST", withId: true },
  { file: "sellers/[id]/unsuspend/route.ts", method: "POST", withId: true },
  { file: "ownership-transfers/[id]/cancel/route.ts", method: "POST", withId: true },
  { file: "replies/[id]/remove/route.ts", method: "POST", withId: true },
  { file: "sellers/[id]/reply-restriction/route.ts", method: "POST", withId: true },
  { file: "sellers/[id]/reply-restriction/[enforcementId]/lift/route.ts", method: "POST", withId: true },
  { file: "users/[id]/reply-restriction/route.ts", method: "POST", withId: true },
  { file: "users/[id]/reply-restriction/[enforcementId]/lift/route.ts", method: "POST", withId: true },
  // M4: report cases, proofs and the verified label (m4-m5-spec 4.2, 5.6)
  { file: "erasures/route.ts", method: "GET", withId: false },
  { file: "moderation/[id]/dismiss-reports/route.ts", method: "POST", withId: true },
  { file: "moderation/[id]/remove/route.ts", method: "POST", withId: true },
  { file: "reports/[id]/reject/route.ts", method: "POST", withId: true },
  { file: "proofs/route.ts", method: "GET", withId: false },
  { file: "proofs/[id]/route.ts", method: "GET", withId: true },
  { file: "proofs/[id]/decide/route.ts", method: "POST", withId: true },
  { file: "reviews/[id]/verified-label/revoke/route.ts", method: "POST", withId: true },
  // M5-02: flagged / quarantined media
  { file: "media/route.ts", method: "GET", withId: false },
  { file: "media/[id]/decide/route.ts", method: "POST", withId: true },
  // Staff role management: SUPER_ADMIN only (ADR-0003, SEC-09e). Both handlers are covered.
  { file: "staff/[id]/roles/route.ts", method: "POST", withId: true, superOnly: true },
  { file: "staff/[id]/roles/route.ts", method: "DELETE", withId: true, superOnly: true },
];
const ADMIN_TIER = ADMIN_ROUTES.filter((r) => !r.superOnly);
const SUPER_ONLY = ADMIN_ROUTES.filter((r) => r.superOnly);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === "route.ts" ? [path] : [];
  });
}

const request = (route: AdminRoute) =>
  new Request(`http://app.test/api/admin/${route.file.replace(/\/route\.ts$/, "")}`, {
    method: route.method,
    headers: { "content-type": "application/json", origin: "http://app.test", "sec-fetch-site": "same-origin" },
    body: route.method === "GET" ? undefined : JSON.stringify({ reason: "matrix" }),
  });

async function call(route: AdminRoute): Promise<Response> {
  const mod = (await import(join(ADMIN_DIR, route.file))) as Record<string, (req: Request, ctx: unknown) => Promise<Response>>;
  const handler = mod[route.method];
  if (typeof handler !== "function") throw new Error(`${route.file} does not export ${route.method}`);
  const ctx = { params: Promise.resolve(route.withId ? { id: "c1" } : {}) };
  return handler(request(route), ctx);
}

describe("admin authz matrix (SEC-09a)", () => {
  beforeEach(() => authMock.mockReset());

  it("the matrix covers every route.ts under /api/admin", () => {
    const discovered = routeFiles(ADMIN_DIR).map((f) => relative(ADMIN_DIR, f).split("\\").join("/")).sort();
    expect(discovered).toEqual([...new Set(ADMIN_ROUTES.map((r) => r.file))].sort());
  });

  it.each(ADMIN_ROUTES)("AZ-025 $method /api/admin/$file: anonymous -> 401", async (route) => {
    authMock.mockResolvedValue(null);
    expect((await call(route)).status).toBe(401);
  });

  it.each(ADMIN_ROUTES)("AZ-025 $method /api/admin/$file: signed-in non-admin -> 403", async (route) => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "user" } });
    expect((await call(route)).status).toBe(403);
  });

  it.each(ADMIN_TIER)("AZ-025 $method /api/admin/$file: admin passes the guard (control)", async (route) => {
    authMock.mockResolvedValue({ user: { id: "a1", role: "admin", sid: "sid1", twoFactor: { enrolled: true, verified: true }, stepUpAt: Date.now() } });
    const status = (await call(route)).status;
    // The DB is an empty stub, so the handler fails later; the point is that the guard let it through.
    expect([401, 403]).not.toContain(status);
  });

  it.each(ADMIN_TIER)("SEC-09e $method /api/admin/$file: super admin also passes the guard", async (route) => {
    authMock.mockResolvedValue({ user: { id: "s1", role: "super_admin", sid: "sid1", twoFactor: { enrolled: true, verified: true }, stepUpAt: Date.now() } });
    expect([401, 403]).not.toContain((await call(route)).status);
  });

  it.each(SUPER_ONLY)("SEC-09e $method /api/admin/$file: ADMIN is refused -> 403", async (route) => {
    authMock.mockResolvedValue({ user: { id: "a1", role: "admin", sid: "sid1", twoFactor: { enrolled: true, verified: true }, stepUpAt: Date.now() } });
    expect((await call(route)).status).toBe(403);
  });

  it.each(SUPER_ONLY)("SEC-09e $method /api/admin/$file: SUPER_ADMIN passes the guard (control)", async (route) => {
    authMock.mockResolvedValue({ user: { id: "s1", role: "super_admin", sid: "sid1", twoFactor: { enrolled: true, verified: true }, stepUpAt: Date.now() } });
    expect([401, 403]).not.toContain((await call(route)).status);
  });
});

describe("roleFrom (ADR-0003 tier split)", () => {
  it("maps staff rows to the highest admin tier", async () => {
    vi.doMock("next-auth", () => ({ default: () => ({ handlers: {}, auth: () => null, signIn: null, signOut: null }) }));
    vi.doMock("next-auth/providers/credentials", () => ({ default: () => ({}) }));
    vi.doMock("@rp/db", () => ({ hashPassword: vi.fn(), verifyPassword: vi.fn() }));
    vi.doUnmock("@/server/auth");
    const { roleFrom } = await import("@/server/auth");
    expect(roleFrom([])).toBe("user");
    expect(roleFrom([{ role: "MODERATOR" }])).toBe("moderator"); // SEC-M6-09: moderator tiers are live (admin gate still refuses them)
    expect(roleFrom([{ role: "MODERATOR" }, { role: "SENIOR_MODERATOR" }])).toBe("senior_moderator");
    expect(roleFrom([{ role: "ADMIN" }, { role: "MODERATOR" }])).toBe("admin");
    expect(roleFrom([{ role: "ADMIN" }])).toBe("admin");
    expect(roleFrom([{ role: "ADMIN" }, { role: "SUPER_ADMIN" }])).toBe("super_admin");
  });
});
