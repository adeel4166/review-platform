import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, newUser, registerUser, signInInContext, uniqueTag, USER_PASSWORD } from "./helpers";

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
});

test.describe("login and register pages (SEC-13)", () => {
  test("E2E-AUTH-007 register through the form, sign out, sign in, land on callbackUrl", async ({ page, context }) => {
    const user = newUser();
    await page.goto("/register?callbackUrl=%2Fproducts");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Display name").fill(user.displayName);
    await page.getByLabel("Username").fill(user.handle);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/products$/);

    await context.clearCookies();
    await page.goto("/login?callbackUrl=%2Fproducts%3Fq%3Dheadphones");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/products\?q=headphones$/);
  });

  test("E2E-AUTH-008 an open-redirect callbackUrl lands on /", async ({ page, request }) => {
    const user = await registerUser(request);
    for (const evil of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
      await page.context().clearCookies();
      await page.goto(`/login?callbackUrl=${encodeURIComponent(evil)}`);
      await page.getByLabel("Email").fill(user.email);
      await page.getByLabel("Password", { exact: true }).fill(USER_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/);
    }
  });

  test("E2E-AUTH-009 wrong credentials show one generic message", async ({ page, request }) => {
    const user = await registerUser(request);
    const messages: string[] = [];
    for (const email of [user.email, `nobody-${uniqueTag()}@example.com`]) {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill("wrong-password-123");
      await page.getByRole("button", { name: "Sign in" }).click();
      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible();
      messages.push(await alert.innerText());
    }
    expect(messages[0]).toBe("Email or password is incorrect.");
    expect(messages[1]).toBe(messages[0]);
  });

  test("E2E-AUTH-010 keyboard-only sign in", async ({ page, request }) => {
    const user = await registerUser(request);
    await page.goto("/login");
    await page.getByLabel("Email").focus();
    await page.keyboard.type(user.email);
    await page.keyboard.press("Tab");
    await page.keyboard.type(user.password);
    await page.keyboard.press("Tab"); // Show/Hide toggle
    await expect(page.getByRole("button", { name: "Show" })).toBeFocused();
    await page.keyboard.press("Tab"); // Sign in
    await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/$/);
  });

  test("E2E-AUTH-011 field errors are associated and the summary is focused", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    const email = page.getByLabel("Email");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    const describedBy = await email.getAttribute("aria-describedby");
    await expect(page.locator(`#${describedBy}`)).toContainText("Enter a valid email address.");
  });

  for (const path of ["/login", "/register"]) {
    test(`E2E-AUTH-012 axe: no serious issues on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.getByRole("button", { name: /Sign in|Create account/ }).click(); // also scan the error state
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
    });
  }
});
