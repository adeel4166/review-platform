import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, PRODUCT_SLUG, UNSURE_BODY, CLEAN_BODY, createSellerViaUi, enrolTwoFactor, expectPublicReview, newVerifiedUser, signedInContext, submitReview, uniqueTag } from "./helpers";

// M3b-07: seller reply composer, 'pending moderation' state, admin queue entry, public display.
// Setup: the owner enrols 2FA, claims the seeded product (SELLER + PRODUCT scope claims), and an admin approves both claims.
// Run against a fresh database: a product that already belongs to another seller turns the claim into a contested one.

async function approveClaims(browser: Browser, baseURL: string | undefined, sellerName: string, count: number) {
  const ctx = await signedInContext(browser, baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);
  const admin = await ctx.newPage();
  await admin.goto("/admin/seller-claims");
  for (let i = 0; i < count; i++) {
    const rows = admin.getByRole("row", { name: new RegExp(sellerName) });
    await expect(rows.first()).toBeVisible();
    const before = await rows.count();
    await rows.first().getByRole("button", { name: /^Approve claim/ }).click();
    await expect(rows).toHaveCount(before - 1);
  }
  await ctx.close();
}

test.describe("seller replies (M3b-07)", () => {
  test("E2E-REPLY-1 submit a reply, see it pending, approve in the admin queue, see it public", async ({ browser, baseURL }) => {
    const tag = uniqueTag();
    const sellerName = `Reply Shop ${tag}`;
    const reviewer = await newVerifiedUser(browser, baseURL);
    const title = `Reply target ${tag}`;
    await submitReview(reviewer.page, { rating: 4, title, body: CLEAN_BODY });
    await expectPublicReview(reviewer.page, title);

    const owner = await newVerifiedUser(browser, baseURL);
    const sellerId = await createSellerViaUi(owner.page, sellerName);
    await enrolTwoFactor(owner.page, owner.user.password);
    const product = (await (await owner.context.request.get(`/api/products/${PRODUCT_SLUG}`)).json()) as { id: string };
    for (const data of [{ scope: "SELLER", method: "DOCUMENT" }, { scope: "PRODUCT", productId: product.id, method: "DOCUMENT" }]) {
      const res = await owner.context.request.post(`/api/sellers/${sellerId}/claims`, { data });
      expect(res.status(), await res.text()).toBe(201);
    }
    await approveClaims(browser, baseURL, sellerName, 2);

    // Composer is on the product page for seller members.
    await owner.page.goto(`/products/${PRODUCT_SLUG}`);
    const card = owner.page.getByRole("article").filter({ has: owner.page.getByRole("heading", { name: title, exact: true }) });
    await card.getByRole("button", { name: /^Reply/ }).click();
    await expect(card.getByText("Be factual and polite.")).toBeVisible();
    await card.getByLabel("Your reply").fill("   ");
    await card.getByRole("button", { name: "Post reply" }).click();
    await expect(card.getByRole("alert")).toContainText("Write a reply first.");
    // Wording that the mock moderation provider sends to a human, so it lands in the admin queue.
    await card.getByLabel("Your reply").fill(UNSURE_BODY);
    await card.getByRole("button", { name: "Post reply" }).click();
    await expect(card.getByTestId("reply-status")).toHaveText("Pending moderation");
    await expect(card.getByText("Your reply is pending moderation.")).toBeVisible();

    // Not public while pending.
    const anon = await browser.newContext({ baseURL });
    const ap = await anon.newPage();
    await ap.goto(`/products/${PRODUCT_SLUG}`);
    await expect(ap.getByTestId("public-reply")).toHaveCount(0);

    // Admin queue entry.
    const adminCtx = await signedInContext(browser, baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);
    const admin = await adminCtx.newPage();
    await admin.goto("/admin/moderation");
    await admin.getByLabel("Type").selectOption("SELLER_REPLY");
    const item = admin.getByRole("listitem").filter({ hasText: UNSURE_BODY.slice(0, 30) });
    await expect(async () => {
      await admin.getByLabel("Type").selectOption("REVIEW");
      await admin.getByLabel("Type").selectOption("SELLER_REPLY");
      await expect(item).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 90_000, intervals: [2_000, 3_000, 5_000] });
    await item.getByRole("button", { name: /^Review case/ }).click();
    await expect(admin.getByTestId("mod-reply-body")).toHaveText(UNSURE_BODY);
    await admin.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(admin.getByText("Case approved.")).toBeVisible();

    // Public display after approval.
    await expect(async () => {
      await ap.goto(`/products/${PRODUCT_SLUG}`);
      await expect(ap.getByTestId("public-reply").filter({ hasText: UNSURE_BODY })).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 60_000, intervals: [2_000, 3_000] });
    await expect(ap.getByTestId("public-reply")).toContainText(`Reply from ${sellerName}`);
    for (const scheme of ["light", "dark"] as const) {
      await ap.emulateMedia({ colorScheme: scheme });
      const r = await new AxeBuilder({ page: ap }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical"), scheme).toEqual([]);
    }
    for (const c of [reviewer.context, owner.context, adminCtx, anon]) await c.close();
  });
});
