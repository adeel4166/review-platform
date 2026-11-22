import { expect, test } from "@playwright/test";
import { PRODUCT_SLUG, newSignedInUser } from "./helpers";
import { makeStaffWith2fa, seedPublishedReview, verifyEmailInDb } from "./social-helpers";

// DEF-LIVE-03: helpful vote (including own-review refusal) and report -> moderation queue.

test.describe("vote and report (DEF-LIVE-03)", () => {
  test("E2E-VOTE-1 a verified reader votes helpful, the count updates, and pressing again retracts it", async ({ browser, baseURL }) => {
    const r = await seedPublishedReview();
    const { context, user } = await newSignedInUser(browser, baseURL);
    await verifyEmailInDb(user.email);
    const page = await context.newPage();
    await page.goto(`/products/${PRODUCT_SLUG}`);
    const card = page.locator("article, li").filter({ has: page.getByRole("heading", { level: 3, name: r.title, exact: true }) }).last();
    const yes = card.getByRole("button", { name: /^Helpful, \d+ so far$/ });
    await expect(yes).toHaveAttribute("aria-pressed", "false");
    await yes.click();
    await expect(yes).toHaveAttribute("aria-pressed", "true");
    await expect(yes).toHaveAccessibleName("Helpful, 1 so far");
    await page.reload();
    await expect(card.getByRole("button", { name: "Helpful, 1 so far" })).toHaveAttribute("aria-pressed", "true"); // persisted
    await card.getByRole("button", { name: "Helpful, 1 so far" }).click();
    await expect(card.getByRole("button", { name: "Helpful, 0 so far" })).toHaveAttribute("aria-pressed", "false");
    await context.close();
  });

  test("E2E-VOTE-2 voting on your own review is refused (SELF_VOTE) with a visible message", async ({ browser, baseURL }) => {
    const { context, user } = await newSignedInUser(browser, baseURL);
    const me = await verifyEmailInDb(user.email);
    const { prisma } = await import("@rp/db");
    const product = await prisma.product.findFirstOrThrow({ where: { slug: PRODUCT_SLUG }, select: { id: true } });
    const title = `Own review ${me.id.slice(-6)}`;
    const own = await prisma.review.create({ data: { productId: product.id, authorId: me.id, rating: 5, title, body: "Comfortable for long flights and the noise cancelling blocks the engine hum well.", status: "PUBLISHED", publishedVersion: 1, publishedAt: new Date() } });
    const page = await context.newPage();
    await page.goto(`/products/${PRODUCT_SLUG}`);
    const card = page.locator("article, li").filter({ has: page.getByRole("heading", { level: 3, name: title, exact: true }) }).last();
    await card.getByRole("button", { name: /^Helpful, \d+ so far$/ }).click();
    await expect(card.getByRole("alert")).toContainText("You cannot vote on your own review.");
    expect(await prisma.reviewVote.count({ where: { reviewId: own.id } })).toBe(0);
    await context.close();
  });

  test("E2E-RPT-1 a reader reports a review and it appears in the staff moderation queue", async ({ browser, baseURL }) => {
    const r = await seedPublishedReview();
    const { context, user } = await newSignedInUser(browser, baseURL);
    await verifyEmailInDb(user.email);
    const page = await context.newPage();
    await page.goto(`/products/${PRODUCT_SLUG}`);
    await page.getByRole("button", { name: `Report review "${r.title}"` }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Send report" }).or(dialog.locator("button[type=submit]")).click();
    await expect(dialog.getByRole("alert")).not.toBeEmpty(); // a reason is required
    await dialog.getByRole("radio", { name: "Spam or advertising" }).check();
    await dialog.getByLabel(/details/i).fill("Looks like an advert.");
    await dialog.locator("button[type=submit]").click();
    await expect(dialog.getByRole("status")).toContainText("Thanks. We received your report.");

    const staff = await makeStaffWith2fa(browser, baseURL, "ADMIN");
    await expect.poll(async () => {
      const res = await staff.context.request.get("/api/admin/moderation?trigger=USER_REPORT&pageSize=50");
      if (!res.ok()) return `http ${res.status()}`;
      const body = (await res.json()) as { items: { reviewId?: string | null; reasons?: Record<string, number> }[] };
      const hit = body.items.find((i) => i.reviewId === r.reviewId);
      return hit ? `queued:${hit.reasons?.SPAM ?? 0}` : "not queued";
    }, { timeout: 60_000, intervals: [1_000, 2_000, 3_000], message: "reported review is in the USER_REPORT queue" }).toBe("queued:1");
    await staff.page.goto("/admin/moderation");
    await expect(staff.page.getByRole("heading", { level: 1 })).toBeVisible();
    await staff.context.close();
    await context.close();
  });
});
