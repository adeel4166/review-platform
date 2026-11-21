import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { enrolTwoFactor, loginViaForm, newVerifiedUser } from "./helpers";

// M3b-07: 2FA enrolment (QR + manual key, confirm, recovery codes once), challenge page, recovery-code login.
// Needs TOTP_ENC_KEYS / RECOVERY_CODE_PEPPERS in the web env (set in CI). Codes are generated here with RFC 6238.

const serious = (v: { impact?: string | null }) => v.impact === "serious" || v.impact === "critical";

test.describe("two-factor (M3b-07)", () => {
  test("E2E-2FA-1 enrol, sign in with the authenticator code, then with a recovery code (single use)", async ({ browser, baseURL }) => {
    const { context, page, user } = await newVerifiedUser(browser, baseURL);
    const { totp, recoveryCodes } = await enrolTwoFactor(page, user.password);

    // Recovery codes are shown once: reopening the wizard shows no codes.
    await page.goto("/account/security/2fa/setup");
    await expect(page.getByText("Two-step verification is already on for your account.")).toBeVisible();
    await expect(page.getByTestId("recovery-codes")).toHaveCount(0);

    // Authenticator code login.
    const a = await browser.newContext({ baseURL });
    const pa = await a.newPage();
    await loginViaForm(pa, user.email, user.password);
    await expect(pa).toHaveURL(/\/login\/2fa/);
    await expect(pa.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
    await expect(pa.getByLabel("Code")).toBeFocused();
    await pa.getByLabel("Code").fill("000000");
    await pa.getByRole("button", { name: "Verify" }).click();
    await expect(pa.getByRole("alert")).toContainText("didn't work");
    await pa.getByLabel("Code").fill(await totp.next());
    await pa.getByRole("button", { name: "Verify" }).click();
    await expect(pa).toHaveURL(/\/$/);
    expect(((await (await a.request.get("/api/account/2fa")).json()) as { enabled: boolean }).enabled).toBe(true);
    await a.close();

    // Recovery-code login; the same code cannot be used twice.
    const code = recoveryCodes[0]!;
    for (const [ok, label] of [[true, "first use"], [false, "replay"]] as const) {
      const c = await browser.newContext({ baseURL });
      const pc = await c.newPage();
      await loginViaForm(pc, user.email, user.password);
      await expect(pc).toHaveURL(/\/login\/2fa/);
      await pc.getByRole("button", { name: "Use a recovery code instead" }).click();
      await pc.getByLabel("Recovery code").fill(code);
      await pc.getByRole("button", { name: "Verify" }).click();
      if (ok) await expect(pc, label).toHaveURL(/\/$/);
      else await expect(pc.getByRole("alert"), label).toContainText("recovery code didn't work");
      await c.close();
    }
    await context.close();
  });

  test("E2E-2FA-2 a half-signed-in browser is held on the challenge page", async ({ browser, baseURL }) => {
    const { context, page, user } = await newVerifiedUser(browser, baseURL);
    await enrolTwoFactor(page, user.password);
    const c = await browser.newContext({ baseURL });
    const pc = await c.newPage();
    await loginViaForm(pc, user.email, user.password);
    await expect(pc).toHaveURL(/\/login\/2fa/);
    await pc.goto("/seller");
    await expect(pc).toHaveURL(/\/login\/2fa/);
    expect((await c.request.get("/api/account/2fa")).status()).toBe(401);
    await c.close();
    await context.close();
  });

  test("E2E-2FA-3 WCAG: setup and challenge pages in light and dark themes", async ({ browser, baseURL }) => {
    const { context, page, user } = await newVerifiedUser(browser, baseURL);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/account/security/2fa/setup");
      await expect(page.getByRole("button", { name: "Start setup" })).toBeVisible();
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      expect(r.violations.filter(serious), `setup ${scheme}`).toEqual([]);
    }
    await enrolTwoFactor(page, user.password);
    const c = await browser.newContext({ baseURL });
    const pc = await c.newPage();
    for (const scheme of ["light", "dark"] as const) {
      await pc.emulateMedia({ colorScheme: scheme });
      await loginViaForm(pc, user.email, user.password);
      await expect(pc).toHaveURL(/\/login\/2fa/);
      const r = await new AxeBuilder({ page: pc }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      expect(r.violations.filter(serious), `challenge ${scheme}`).toEqual([]);
    }
    await c.close();
    await context.close();
  });
});
