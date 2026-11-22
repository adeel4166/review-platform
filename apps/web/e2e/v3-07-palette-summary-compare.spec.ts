import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PRODUCT_SLUG } from "./helpers";

/** V3-07: command palette, AI summary card, product charts, compare redesign. */
const serious = (r: { violations: { impact?: string | null }[] }) => r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.describe("V3-07 command palette", () => {
  test("Ctrl+K opens, debounced search shows image/category/rating, arrows + Enter navigate, Escape closes", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search products" });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole("combobox");
    await expect(input).toBeFocused();
    await input.fill("Espresso");
    const option = dialog.getByRole("option", { name: /Espresso/ }).first();
    await expect(option).toBeVisible();
    await expect(option).toContainText(/\d\.\d|No ratings yet/);
    await expect(dialog.getByTestId("palette-status")).toContainText(/results available/);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/products\//);
    await expect(dialog).toHaveCount(0);

    await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("header button opens it, no-match query shows the empty state, focus returns to the button", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByTestId("palette-trigger");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Search products" });
    await dialog.getByRole("combobox").fill("zzzz-no-such-product-xyz");
    await expect(dialog.getByText(/No products match/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`axe: palette open is clean (${theme})`, async ({ page }) => {
      await page.addInitScript((th) => localStorage.setItem("rp-theme", th), theme);
      await page.goto("/");
      await page.keyboard.press("Control+k");
      const dialog = page.getByRole("dialog", { name: "Search products" });
      await dialog.getByRole("combobox").fill("Espresso");
      await expect(dialog.getByRole("option").first()).toBeVisible();
      expect(serious(await new AxeBuilder({ page }).withTags(TAGS).analyze())).toEqual([]);
    });
  }
});

test.describe("V3-07 product page: summary card and charts", () => {
  test("charts lazy-load and expose text alternatives; the summary card, when present, is labelled and collapsible", async ({ page }) => {
    await page.goto(`/products/${PRODUCT_SLUG}`);
    await expect(page.getByTestId("chart-distribution")).toBeVisible();
    await expect(page.getByTestId("chart-verified")).toBeVisible();
    const card = page.getByTestId("ai-summary");
    if (await card.count()) { // present only when a READY summary exists and the feature flag is on
      await expect(page.getByTestId("ai-summary-label")).toContainText(/AI-generated from \d+ verified review/);
      const toggle = card.getByRole("button", { name: "Show pros and cons" });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(card.getByRole("button", { name: "Hide pros and cons" })).toHaveAttribute("aria-expanded", "true");
      await expect(card.getByRole("heading", { name: "Pros" })).toBeVisible();
    } else {
      await expect(card).toHaveCount(0);
    }
  });

  for (const theme of ["light", "dark"] as const) {
    test(`axe: product page with charts is clean (${theme})`, async ({ page }) => {
      await page.addInitScript((th) => localStorage.setItem("rp-theme", th), theme);
      await page.goto(`/products/${PRODUCT_SLUG}`);
      await expect(page.getByTestId("chart-distribution")).toBeVisible();
      expect(serious(await new AxeBuilder({ page }).withTags(TAGS).analyze())).toEqual([]);
    });
  }
});

test.describe("V3-07 compare redesign", () => {
  async function openCompare(page: import("@playwright/test").Page) {
    await page.goto("/products?q=Acme");
    await page.getByRole("checkbox", { name: /Noise-Cancelling Headphones/ }).check();
    await page.getByRole("checkbox", { name: /Espresso Maker/ }).check();
    await page.getByRole("button", { name: /compare/i }).click();
    await expect(page).toHaveURL(/\/compare\?/);
  }

  test("desktop: table with product headers and a text-labelled best value", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openCompare(page);
    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveCount(3);
    await expect(table.getByRole("link", { name: /Espresso Maker/ })).toBeVisible();
    await expect(table.getByTestId("best").first()).toContainText("Best");
    const pos = await table.locator("thead th").nth(1).evaluate((el) => getComputedStyle(el).position);
    expect(pos).toBe("sticky");
  });

  test("mobile: swipe layout shows one card per product, keyboard scrollable", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openCompare(page);
    const swipe = page.getByTestId("compare-swipe");
    await expect(swipe).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(swipe.getByRole("heading", { level: 2 })).toHaveCount(2);
    const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(noHScroll).toBe(true);
    await swipe.focus();
    await expect(swipe).toBeFocused();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`axe: compare is clean (${theme})`, async ({ page }) => {
      await page.addInitScript((th) => localStorage.setItem("rp-theme", th), theme);
      await openCompare(page);
      expect(serious(await new AxeBuilder({ page }).withTags(TAGS).analyze())).toEqual([]);
    });
  }
});
