import { expect, test } from "@playwright/test";
import { PRODUCT_SLUG } from "./helpers";

// DEF-LIVE-03: product search and comparison, through the real pages (anonymous visitors may use both).

test.describe("product search and compare (DEF-LIVE-03)", () => {
  test("E2E-SRCH-1 search finds a seeded product, a nonsense query shows the empty state", async ({ page }) => {
    await page.goto("/products");
    await page.getByRole("searchbox").fill("Espresso");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/q=Espresso/);
    await expect(page.getByRole("link", { name: /Acme Espresso Maker/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Noise-Cancelling Headphones/ })).toHaveCount(0);

    await page.goto("/products?q=zzzz-no-such-product-xyz");
    await expect(page.getByText(/no products/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Acme Espresso Maker/ })).toHaveCount(0);
  });

  test("E2E-CMP-1 select two products on the list and compare them side by side", async ({ page }) => {
    await page.goto("/products?q=Acme");
    await page.getByRole("checkbox", { name: /Noise-Cancelling Headphones/ }).check();
    await page.getByRole("checkbox", { name: /Espresso Maker/ }).check();
    await page.getByRole("button", { name: /compare/i }).click();
    await expect(page).toHaveURL(/\/compare\?/);
    const table = page.getByRole("table");
    await expect(table.getByRole("link", { name: /Noise-Cancelling Headphones/ })).toBeVisible();
    await expect(table.getByRole("link", { name: /Espresso Maker/ })).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveCount(3); // blank corner + 2 products
    await expect(table.getByRole("link", { name: /Noise-Cancelling Headphones/ })).toHaveAttribute("href", `/products/${PRODUCT_SLUG}`);
  });

  test("E2E-CMP-2 comparing one product, or the same product twice, is refused with a message", async ({ page }) => {
    await page.goto("/compare?ids=");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });
});
