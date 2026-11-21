import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, newUser, registerUser, signInInContext, USER_PASSWORD } from "./helpers";

test.describe("sign up and login", () => {
  test("E2E-AUTH-001 a new user registers and signs in", async ({ context, request }) => {
    const user = await registerUser(request);
    await signInInContext(context, user.email, USER_PASSWORD);

    const page = await context.newPage();
    await page.goto("/products");
    await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  });

  test("E2E-AUTH-002 a wrong password does not create a session", async ({ context, request }) => {
    const user = await registerUser(request, newUser());
    const csrf = (await (await context.request.get("/api/auth/csrf")).json()) as { csrfToken: string };
    await context.request.post("/api/auth/callback/credentials", {
      form: { csrfToken: csrf.csrfToken, email: user.email, password: "definitely-wrong-password", json: "true" },
    });
    const session = (await (await context.request.get("/api/auth/session")).json()) as { user?: unknown };
    expect(session.user ?? null).toBeNull();
  });

  test("E2E-AUTH-003 a duplicate email is refused at registration", async ({ request }) => {
    const user = await registerUser(request);
    const again = await request.post("/api/auth/register", {
      data: { email: user.email, password: user.password, handle: `${user.handle}x`, displayName: "Dup" },
    });
    expect(again.status()).toBe(409);
  });

  test("E2E-AUTH-004 an anonymous visitor to the moderation dashboard is sent to login", async ({ page }) => {
    await page.goto("/admin/moderation");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fadmin%2Fmoderation|\/login\?callbackUrl=\/admin\/moderation/);
  });

  test("E2E-AUTH-005 a regular user cannot call the moderation API", async ({ context, request }) => {
    const user = await registerUser(request);
    await signInInContext(context, user.email, USER_PASSWORD);
    const res = await context.request.get("/api/admin/moderation");
    expect(res.status()).toBe(403);
  });

  test("E2E-AUTH-006 the seeded admin can sign in", async ({ context }) => {
    await signInInContext(context, ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await context.request.get("/api/admin/moderation");
    expect(res.ok()).toBeTruthy();
  });

  // Known gap: there is no /login or /register page yet, so the visible form journey cannot be tested.
  // Quarantined as fixme (skipped, reported) until the auth UI lands. See e2e/QUARANTINE.md.
  test.fixme("E2E-AUTH-007 sign in through the login form", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login/);
  });
});
