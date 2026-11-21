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
interface AdminRoute { file: string; method: Method; withId: boolean }

/** Every /api/admin/* route handler. The discovery test below fails if a route file is missing from this table. */
const ADMIN_ROUTES: AdminRoute[] = [
  { file: "audit/route.ts", method: "GET", withId: false },
  { file: "moderation/route.ts", method: "GET", withId: false },
  { file: "moderation/[id]/route.ts", method: "GET", withId: true },
  { file: "moderation/[id]/approve/route.ts", method: "POST", withId: true },
  { file: "moderation/[id]/reject/route.ts", method: "POST", withId: true },
];

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
    expect(discovered).toEqual(ADMIN_ROUTES.map((r) => r.file).sort());
  });

  it.each(ADMIN_ROUTES)("AZ-025 $method /api/admin/$file: anonymous -> 401", async (route) => {
    authMock.mockResolvedValue(null);
    expect((await call(route)).status).toBe(401);
  });

  it.each(ADMIN_ROUTES)("AZ-025 $method /api/admin/$file: signed-in non-admin -> 403", async (route) => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "user" } });
    expect((await call(route)).status).toBe(403);
  });

  it.each(ADMIN_ROUTES)("AZ-025 $method /api/admin/$file: admin passes the guard (control)", async (route) => {
    authMock.mockResolvedValue({ user: { id: "a1", role: "admin" } });
    const status = (await call(route)).status;
    // The DB is an empty stub, so the handler fails later; the point is that the guard let it through.
    expect([401, 403]).not.toContain(status);
  });
});
