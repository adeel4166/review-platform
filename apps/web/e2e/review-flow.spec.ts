import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  CLEAN_BODY,
  PRODUCT_SLUG,
  REJECT_BODY,
  UNSURE_BODY,
  expectNotPublic,
  expectPublicReview,
  newSignedInUser,
  signedInContext,
  submitReview,
  uniqueTag,
  waitForCaseState,
} from "./helpers";

// Review journey: author submits -> worker runs the mock AI moderation -> verdict -> admin where needed -> public page.
// Requires the worker process (apps/worker) running next to the web server. Mock provider verdicts: see helpers.ts.

/** Waits until the admin queue lists the title, reloading the page while it waits. */
async function openCaseInQueue(admin: import("@playwright/test").Page, title: string) {
  const item = admin.getByRole("listitem").filter({ hasText: title });
  await admin.goto("/admin/moderation");
  await expect(async () => {
    await admin.reload();
    await expect(item).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000, intervals: [2_000, 3_000, 5_000] });
  await item.getByRole("button", { name: "Review case" }).click();
  return item;
}

test.describe("review moderation flow", () => {
  test("E2E-MOD-001 clean review is auto-approved and shown on the product page", async ({ browser, baseURL }) => {
    const title = `E2E auto-approve ${uniqueTag()}`;
    const { context } = await newSignedInUser(browser, baseURL);
    const page = await context.newPage();

    await submitReview(page, { rating: 5, title, body: CLEAN_BODY });
    await expectPublicReview(page, title);
    await context.close();
  });

  test("E2E-MOD-002 unsure review waits for a human and is published after admin approval", async ({ browser, baseURL }) => {
    const title = `E2E needs-human ${uniqueTag()}`;
    const { context: author } = await newSignedInUser(browser, baseURL);
    await submitReview(await author.newPage(), { rating: 4, title, body: UNSURE_BODY });

    const adminCtx = await signedInContext(browser, baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);
    const admin = await adminCtx.newPage();
    const item = await openCaseInQueue(admin, title);
    await admin.getByLabel("Reason", { exact: true }).fill("Checked: a fair opinion, not a violation");
    await admin.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(item).toBeHidden();

    await expectPublicReview(await author.newPage(), title);
    await author.close();
    await adminCtx.close();
  });

  test("E2E-MOD-003 AI-rejected review is never published and never reaches the human queue", async ({ browser, baseURL }) => {
    const title = `E2E ai-reject ${uniqueTag()}`;
    const { context: author } = await newSignedInUser(browser, baseURL);
    await submitReview(await author.newPage(), { rating: 1, title, body: REJECT_BODY });

    const adminCtx = await signedInContext(browser, baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);
    await waitForCaseState(adminCtx.request, "REJECTED", title);
    const queue = await adminCtx.request.get("/api/admin/moderation?state=NEEDS_HUMAN&pageSize=50");
    const body = (await queue.json()) as { items: { review: { title: string } }[] };
    expect(body.items.some((i) => i.review.title === title)).toBe(false);

    await expectNotPublic(await author.newPage(), title);
    await author.close();
    await adminCtx.close();
  });

  test("E2E-MOD-004 admin rejection of an unsure review keeps it hidden", async ({ browser, baseURL }) => {
    const title = `E2E admin-reject ${uniqueTag()}`;
    const { context: author } = await newSignedInUser(browser, baseURL);
    await submitReview(await author.newPage(), { rating: 2, title, body: UNSURE_BODY });

    const adminCtx = await signedInContext(browser, baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);
    const admin = await adminCtx.newPage();
    const item = await openCaseInQueue(admin, title);
    await admin.getByLabel("Reason", { exact: true }).fill("Unverified accusation against the seller");
    await admin.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(item).toBeHidden();

    await waitForCaseState(adminCtx.request, "REJECTED", title);
    await expectNotPublic(await author.newPage(), title);
    await author.close();
    await adminCtx.close();
  });

  test("E2E-MOD-005 review with an image: the photo upload to object storage succeeds", async ({ browser, baseURL }) => {
    const { context: author } = await newSignedInUser(browser, baseURL);
    const reviewId = await submitReview(await author.newPage(), {
      rating: 5, title: `E2E with image ${uniqueTag()}`, body: CLEAN_BODY, photo: true,
    });

    // The presigned PUT and the confirm call both succeeded if the asset left UPLOADING and was not rejected for a
    // size, type or missing-object reason. Post-processing (ClamAV, libvips) is covered by E2E-MOD-006 (quarantine).
    const uploadFailures = ["MISSING_OBJECT", "TYPE_MISMATCH", "TOO_LARGE"];
    let item: { status: string; failureReason: string | null } | undefined;
    await expect.poll(async () => {
      const res = await author.request.get(`/api/reviews/${reviewId}/media`);
      item = ((await res.json()) as { items: { status: string; failureReason: string | null }[] }).items[0];
      return item?.status ?? "none";
    }, { timeout: 30_000 }).not.toMatch(/^(UPLOADING|none)$/);
    expect(uploadFailures).not.toContain(item?.failureReason);
    await author.close();
  });

  // Quarantined: the photo must end up READY and be shown on the published review. This needs the media worker
  // with ClamAV and libvips, which CI does not run yet. See e2e/QUARANTINE.md.
  test("E2E-MOD-006 @quarantine uploaded photo appears on the published review", async ({ browser, baseURL }) => {
    const title = `E2E photo visible ${uniqueTag()}`;
    const { context: author } = await newSignedInUser(browser, baseURL);
    await submitReview(await author.newPage(), { rating: 5, title, body: CLEAN_BODY, photo: true });

    const page = await author.newPage();
    await expect(async () => {
      await page.goto(`/products/${PRODUCT_SLUG}`);
      await expect(page.getByRole("img", { name: /^Photo 1 of review/ })).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 120_000, intervals: [3_000, 5_000] });
    await author.close();
  });
});
