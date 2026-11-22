import { expect, test, type Page } from "@playwright/test";
import { PRODUCT_SLUG, REVIEW_PATH, newSignedInUser } from "./helpers";
import { makeStaff } from "./m6-helpers";

/**
 * V3-08 visual regression: landing, products, product page, compare, review form, profile and the admin queues, in light and dark
 * at mobile (375) and desktop (1280). Baselines are NOT committed from the QA sandbox (no browser there): create them once on the
 * CI image with `pnpm --filter @rp/web test:e2e -- v3-08-visual --update-snapshots` and review the PNGs before merging.
 * Animations are frozen, carets hidden; dynamic regions (dates, avatars, counts) are masked via [data-visual-mask] or by role.
 */
const THEMES = ["light", "dark"] as const;
const SIZES = { mobile: { width: 375, height: 800 }, desktop: { width: 1280, height: 800 } } as const;

async function prep(page: Page, theme: (typeof THEMES)[number]) {
  await page.addInitScript((th) => localStorage.setItem("rp-theme", th), theme);
}
async function snap(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true, animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.01,
    mask: [page.locator("time"), page.locator("[data-visual-mask]")],
  });
}
async function openCompare(page: Page) {
  await page.goto("/products?q=Acme");
  await page.getByRole("checkbox", { name: /Noise-Cancelling Headphones/ }).check();
  await page.getByRole("checkbox", { name: /Espresso Maker/ }).check();
  await page.getByRole("button", { name: /compare/i }).click();
  await expect(page).toHaveURL(/\/compare\?/);
}

for (const [size, viewport] of Object.entries(SIZES)) {
  for (const theme of THEMES) {
    test.describe(`V3-08 visual ${size} ${theme}`, () => {
      test.use({ viewport, reducedMotion: "reduce" });

      test("VIS landing", async ({ page }) => { await prep(page, theme); await page.goto("/"); await snap(page, `landing-${size}-${theme}`); });
      test("VIS products", async ({ page }) => { await prep(page, theme); await page.goto("/products"); await snap(page, `products-${size}-${theme}`); });
      test("VIS product page", async ({ page }) => {
        await prep(page, theme); await page.goto(`/products/${PRODUCT_SLUG}`);
        await expect(page.getByTestId("chart-distribution")).toBeVisible();
        await snap(page, `product-${size}-${theme}`);
      });
      test("VIS compare", async ({ page }) => { await prep(page, theme); await openCompare(page); await snap(page, `compare-${size}-${theme}`); });
      test("VIS review form", async ({ browser, baseURL }) => {
        const { context } = await newSignedInUser(browser, baseURL);
        const page = await context.newPage(); await page.setViewportSize(viewport); await prep(page, theme);
        await page.goto(REVIEW_PATH); await expect(page.getByLabel("Title")).toBeVisible();
        await snap(page, `review-form-${size}-${theme}`); await context.close();
      });
      test("VIS profile", async ({ browser, baseURL }) => {
        const { context, user } = await newSignedInUser(browser, baseURL);
        const page = await context.newPage(); await page.setViewportSize(viewport); await prep(page, theme);
        await page.goto(`/u/${user.handle}`); await expect(page.locator("main")).toBeVisible();
        await snap(page, `profile-${size}-${theme}`); await context.close();
      });
      test("VIS admin queues", async ({ browser, baseURL }) => {
        const staff = await makeStaff(browser, baseURL);
        const page = await staff.context.newPage(); await page.setViewportSize(viewport); await prep(page, theme);
        for (const q of ["moderation", "appeals", "approvals", "enforcement", "media", "proofs", "seller-claims"]) {
          await page.goto(`/admin/${q}`); await expect(page.locator("main")).toBeVisible();
          await snap(page, `admin-${q}-${size}-${theme}`);
        }
        await staff.context.close();
      });
    });
  }
}
