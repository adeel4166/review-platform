import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PRODUCT_SLUG } from "./helpers";

/** V3-05: landing, catalog and product page redesign. */
const serious = (r: { violations: { impact?: string | null }[] }) => r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");

test.describe("V3-05 landing, catalog, product page", () => {
  test("landing has hero, bento categories, trending and trust stats", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("actually trust");
    await expect(page.getByRole("heading", { level: 2, name: "Shop by category" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Trending products" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Trust, in numbers" })).toBeVisible();
  });

  test("category filter on the catalog narrows the list and marks the active chip", async ({ page }) => {
    await page.goto("/products");
    const chip = page.getByRole("navigation", { name: "Filter products" }).getByRole("link").nth(1);
    await chip.click();
    await expect(page).toHaveURL(/category=/);
    await expect(page.getByRole("navigation", { name: "Filter products" }).locator('[aria-current="true"]')).toHaveCount(1);
  });

  test("product page shows the gallery region, histogram and opens the lightbox when images exist", async ({ page }) => {
    await page.goto(`/products/${PRODUCT_SLUG}`);
    await expect(page.getByRole("region", { name: /photos$/ })).toBeVisible();
    await expect(page.getByTestId("rating-histogram")).toBeVisible();
    const open = page.getByRole("button", { name: /full screen/ });
    if (await open.count()) {
      await open.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  });

  for (const theme of ["light", "dark"] as const) {
    for (const path of ["/", `/products/${PRODUCT_SLUG}`]) {
      test(`axe: no serious issues on ${path} (${theme}, 360px)`, async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 800 });
        await page.addInitScript((th) => localStorage.setItem("rp-theme", th), theme);
        await page.goto(path);
        const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        expect(hasHScroll).toBe(false);
        expect(serious(await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze())).toEqual([]);
      });
    }
  }

  test("reduced motion: content renders fully visible", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "How trust works" })).toBeVisible();
  });
});
