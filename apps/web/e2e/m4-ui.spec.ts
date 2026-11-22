import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, CLEAN_BODY, PRODUCT_SLUG, ONE_PIXEL_PNG, expectPublicReview, newSignedInUser, newVerifiedUser, signedInContext, submitReview, uniqueTag } from "./helpers";

// M4 UI flows (task #70). Same stack as review-flow.spec.ts: web + worker + seeded DB. Voting/reporting need a
// verified email, so those actors come from newVerifiedUser. Run with the other specs: `pnpm --filter @rp/web e2e`.

const card = (page: import("@playwright/test").Page, title: string) => page.locator("article").filter({ has: page.getByRole("heading", { level: 3, name: title, exact: true }) });

test.describe("M4 votes, edit, report, verified filter", () => {
  test("E2E-M4-001 reader votes helpful, switches and retracts; author cannot vote", async ({ browser, baseURL }) => {
    const title = `E2E vote ${uniqueTag()}`;
    const { context: author } = await newSignedInUser(browser, baseURL);
    const ap = await author.newPage();
    await submitReview(ap, { rating: 5, title, body: CLEAN_BODY });
    await expectPublicReview(ap, title);
    await expect(card(ap, title).getByRole("button", { name: /^Helpful, 0 so far/ })).toBeVisible();
    await card(ap, title).getByRole("button", { name: /^Helpful/ }).click();
    await expect(card(ap, title).getByRole("alert")).toContainText(/cannot vote|Verify your email/);

    const { context: reader, page } = await newVerifiedUser(browser, baseURL);
    await page.goto(`/products/${PRODUCT_SLUG}`);
    const c = card(page, title);
    const yes = c.getByRole("button", { name: /^Helpful/ });
    const no = c.getByRole("button", { name: /^Not helpful/ });
    await yes.click();
    await expect(yes).toHaveAttribute("aria-pressed", "true");
    await expect(yes).toHaveAccessibleName("Helpful, 1 so far");
    await no.click();
    await expect(no).toHaveAttribute("aria-pressed", "true");
    await expect(yes).toHaveAccessibleName("Helpful, 0 so far");
    await no.click(); // pressing the active button retracts
    await expect(no).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await expect(card(page, title).getByRole("button", { name: /^Helpful, 0 so far/ })).toHaveAttribute("aria-pressed", "false");
    await reader.close(); await author.close();
  });

  test("E2E-M4-002 author edits a published review and sees it pending; report dialog is keyboard operable", async ({ browser, baseURL }) => {
    const title = `E2E edit ${uniqueTag()}`;
    const { context, page } = await newVerifiedUser(browser, baseURL);
    await submitReview(page, { rating: 4, title, body: CLEAN_BODY });
    await expectPublicReview(page, title);
    const c = card(page, title);
    await expect(c.getByTestId("edited-indicator")).toHaveCount(0);
    await c.getByRole("button", { name: "Edit review" }).click();
    await c.getByLabel("Your review").fill(`${CLEAN_BODY} Edited a week later.`);
    await c.getByRole("button", { name: "Save changes" }).click();
    await expect(c.getByText(/Your edit is pending moderation/)).toBeVisible();
    // The live version stays visible while the revision is moderated.
    await expect(page.getByRole("heading", { level: 3, name: title, exact: true })).toBeVisible();

    // Another user reports it: dialog traps focus, Esc closes, focus returns to the trigger.
    const { context: other, page: op } = await newVerifiedUser(browser, baseURL);
    await op.goto(`/products/${PRODUCT_SLUG}`);
    const trigger = card(op, title).getByRole("button", { name: `Report review "${title}"` });
    await trigger.click();
    const dialog = op.getByRole("dialog", { name: "Report this review" });
    await expect(dialog).toBeVisible();
    expect(await new AxeBuilder({ page: op }).include('[role="dialog"]').analyze().then((r) => r.violations.filter((v) => v.impact === "serious" || v.impact === "critical"))).toEqual([]);
    await op.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Choose a reason.");
    await dialog.getByRole("radio", { name: "Spam or advertising" }).check();
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog.getByRole("status")).toHaveText("Thanks. We received your report.");
    await other.close(); await context.close();
  });

  test("E2E-M4-003 verified share and the Verified-only switch are URL-synced", async ({ page }) => {
    await page.goto(`/products/${PRODUCT_SLUG}`);
    await expect(page.getByTestId("verified-share")).toContainText(/\d+ of \d+ reviews verified/);
    const sw = page.getByRole("switch", { name: "Verified purchases only" });
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await expect(page).toHaveURL(/verified=1/);
    await expect(page.getByRole("switch", { name: "Verified purchases only" })).toHaveAttribute("aria-checked", "true");
    for (const b of await page.getByTestId("verified-badge").all()) await expect(b).toContainText("Verified purchase");
    expect(await new AxeBuilder({ page }).analyze().then((r) => r.violations.filter((v) => v.impact === "serious" || v.impact === "critical"))).toEqual([]);
  });
});

test.describe("M4 proof of purchase", () => {
  test("E2E-M4-004 author submits proof, admin opens it behind a break-glass reason and rejects it", async ({ browser, baseURL }) => {
    const title = `E2E proof ${uniqueTag()}`;
    const { context, page } = await newVerifiedUser(browser, baseURL);
    await submitReview(page, { rating: 5, title, body: CLEAN_BODY });
    await expectPublicReview(page, title);
    const own = card(page, title).getByTestId("proof-panel");
    await own.getByRole("button", { name: "Add proof of purchase" }).click();
    await own.getByRole("button", { name: "Submit proof" }).click();
    await expect(own.getByRole("alert")).toHaveText("Choose at least one file.");
    await own.getByLabel("Files").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });
    await own.getByRole("button", { name: "Submit proof" }).click();
    await expect(own.getByRole("alert")).toHaveText("Confirm the consent to continue.");
    await own.getByRole("checkbox").check();
    await own.getByRole("button", { name: "Submit proof" }).click();
    await expect(own.getByTestId("proof-status")).toContainText("Waiting for a moderator");

    // Admin queue: the item appears once the worker has redacted the file (filesReadyAt).
    const adminCtx = await signedInContext(browser, baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);
    const admin = await adminCtx.newPage();
    await admin.goto("/admin/proofs");
    await expect(admin.getByRole("heading", { level: 1, name: "Proof of purchase queue" })).toBeVisible();
    const open = admin.getByRole("button", { name: /^Open masked copy of proof/ }).first();
    await expect(async () => { await admin.reload(); await expect(open).toBeVisible({ timeout: 3_000 }); }).toPass({ timeout: 90_000, intervals: [2_000, 3_000, 5_000] });
    await open.click();
    const bg = admin.getByRole("dialog", { name: "Why do you need to open this proof?" });
    await bg.getByRole("button", { name: "Open masked copy" }).click();
    await expect(bg.getByRole("alert")).toHaveText("Write at least 10 characters.");
    await bg.getByLabel(/^Reason/).fill("Reviewing the SLA queue item.");
    await bg.getByRole("button", { name: "Open masked copy" }).click();
    const detail = admin.getByRole("dialog", { name: /^Proof / });
    await expect(detail).toBeVisible();
    await detail.getByRole("button", { name: "Reject…" }).click();
    await detail.getByRole("button", { name: "Confirm rejection" }).click();
    await expect(detail.getByRole("alert")).toHaveText("Choose a rejection reason.");
    await detail.getByLabel("Reason (required)").selectOption("UNREADABLE");
    await detail.getByRole("button", { name: "Confirm rejection" }).click();
    await expect(admin.getByText("Proof rejected.")).toBeVisible();
    await adminCtx.close();

    await page.reload();
    await expect(card(page, title).getByTestId("proof-status")).toContainText("Not accepted");
    await context.close();
  });
});
