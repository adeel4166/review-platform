import { expect, test } from "@playwright/test";
import { PRODUCT_SLUG } from "./helpers";

// The seeded review (packages/db/prisma/seed.ts) is marked verifiedBuyer. Badge rendering is what is tested here.
const SEEDED_VERIFIED_TITLE = "Great sound, average battery";

test.describe("verified buyer label", () => {
  test("E2E-VB-001 a verified review shows the Verified buyer badge on the product page", async ({ page }) => {
    await page.goto(`/products/${PRODUCT_SLUG}`);
    const card = page.locator("article").filter({ has: page.getByRole("heading", { level: 3, name: SEEDED_VERIFIED_TITLE, exact: true }) });
    await expect(card).toHaveCount(1);
    await expect(card.getByText("Verified buyer", { exact: true })).toBeVisible();
  });

  // Known gap: a newly submitted review is never marked verified in the running stack, because the worker uses
  // StubPurchaseLookup with no records (apps/worker/src/processors.ts) and there is no order integration yet (ADR-0008).
  // Fixme until an order source exists. See e2e/QUARANTINE.md.
  test.fixme("E2E-VB-002 a new review by a verified purchaser shows the badge after approval", async () => {
    // Needs a purchase record for the author and product: arrange it through the order adapter once it exists.
  });
});
