import { expect, test } from "@playwright/test";
import { newUser, registerUser, signInInContext, USER_PASSWORD } from "./helpers";

// SEC-09(a): every admin endpoint, over real HTTP, refuses anonymous callers (401) and signed-in non-admins (403).
const ADMIN_CALLS: { method: "GET" | "POST"; path: string }[] = [
  { method: "GET", path: "/api/admin/moderation" },
  { method: "GET", path: "/api/admin/audit" },
  { method: "GET", path: "/api/admin/moderation/00000000-0000-0000-0000-000000000000" },
  { method: "POST", path: "/api/admin/moderation/00000000-0000-0000-0000-000000000000/approve" },
  { method: "POST", path: "/api/admin/moderation/00000000-0000-0000-0000-000000000000/reject" },
];

test.describe("admin API matrix", () => {
  test("E2E-012 anonymous callers get 401 on every /api/admin route", async ({ request }) => {
    for (const call of ADMIN_CALLS) {
      const res = await request.fetch(call.path, {
        method: call.method,
        data: call.method === "POST" ? { reason: "matrix" } : undefined,
      });
      expect(res.status(), `${call.method} ${call.path}`).toBe(401);
    }
  });

  test("E2E-012 signed-in non-admins get 403 on every /api/admin route", async ({ context, request }) => {
    const user = await registerUser(request, newUser());
    await signInInContext(context, user.email, USER_PASSWORD);
    for (const call of ADMIN_CALLS) {
      const res = await context.request.fetch(call.path, {
        method: call.method,
        data: call.method === "POST" ? { reason: "matrix" } : undefined,
      });
      expect(res.status(), `${call.method} ${call.path}`).toBe(403);
    }
  });
});
