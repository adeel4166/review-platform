import { expect, test } from "@playwright/test";
import { prisma } from "@rp/db";
import AxeBuilder from "@axe-core/playwright";
import { PRODUCT_SLUG } from "./helpers";
import { makeStaff, seedHeldReview, waitForResolved } from "./m6-helpers";

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000);

test.describe("M6 hold, expiry and appeal journeys", () => {
  test("E2E-002 UNSURE review: author sees 'Under review', public page hides it, moderator approves, it becomes visible", async ({ browser, baseURL, page }) => {
    const s = await seedHeldReview(browser, baseURL, inHours(72));
    const mod = await makeStaff(browser, baseURL);
    const authorPage = await s.context.newPage();
    await authorPage.goto("/account/submissions");
    await expect(authorPage.getByTestId("submission-status").first()).toContainText("Under review");
    await authorPage.goto(`/decisions/${s.caseId}`);
    await expect(authorPage.getByRole("heading", { name: "Your content is under review" })).toBeVisible();
    await page.goto(`/products/${PRODUCT_SLUG}`);
    await expect(page.getByRole("heading", { name: s.title, exact: true })).toHaveCount(0);

    const mp = await mod.context.newPage();
    await mp.goto("/admin/moderation");
    const row = mp.locator("li", { hasText: s.title });
    await expect(row.getByTestId("hold-expiry")).toContainText("Hold expires in"); // E2E-003: deadline visible in the queue
    await row.getByRole("button", { name: /Open/ }).click();
    await mp.getByRole("button", { name: "Approve" }).click();
    await expect(mp.getByRole("status").filter({ hasText: "Case approved." })).toBeVisible();
    await expect(async () => {
      await page.goto(`/products/${PRODUCT_SLUG}`);
      await expect(page.getByRole("heading", { level: 3, name: s.title, exact: true })).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 90_000, intervals: [2_000, 3_000, 5_000] });
  });

  test("E2E-003 an expired hold is rejected 'not reviewed in time' with an appeal link and no strike", async ({ browser, baseURL }) => {
    const s = await seedHeldReview(browser, baseURL, new Date(Date.now() - 60_000));
    await waitForResolved(s.caseId); // worker sweeper tick
    const p = await s.context.newPage();
    await p.goto(`/decisions/${s.caseId}`);
    await expect(p.getByRole("heading", { name: "Your review was not published" })).toBeVisible();
    await expect(p.getByTestId("notice-reason")).toContainText("did not review this in time");
    await expect(p.getByTestId("notice-strike")).toHaveText("no");
    await expect(p.getByTestId("appeal-link")).toBeVisible();
    expect((await new AxeBuilder({ page: p }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });

  test("E2E-004 appeal of a hold-expired rejection, decided by another moderator, overturns and shows 'live again'", async ({ browser, baseURL, page }) => {
    const s = await seedHeldReview(browser, baseURL, new Date(Date.now() - 60_000));
    await waitForResolved(s.caseId);
    const p = await s.context.newPage();
    await p.goto(`/decisions/${s.caseId}`);
    await p.getByTestId("appeal-link").click();
    await p.getByLabel(/Why should we reconsider/).fill("The review follows the guidelines and was never looked at by a person.");
    await p.getByLabel(/I understand that a person/).check();
    await p.getByRole("button", { name: "Submit appeal" }).click();
    await expect(p.getByRole("heading", { name: "Appeal received" })).toBeVisible();
    const appealId = new URL(p.url()).pathname.split("/").pop()!;

    const mod = await makeStaff(browser, baseURL);
    const mp = await mod.context.newPage();
    await mp.goto("/admin/appeals");
    const row = mp.getByTestId("appeal-row").filter({ hasText: s.author.handle });
    await expect(row).toContainText("Hold expired");
    await row.getByRole("button", { name: /Claim/ }).click();
    const dlg = mp.getByRole("dialog");
    await dlg.getByLabel(/Overturn/).check();
    await dlg.getByLabel(/Message to the appellant/).fill("Not reviewed in time; content is fine.");
    await dlg.getByRole("button", { name: "Record decision" }).click();
    await expect(mp.getByRole("status").filter({ hasText: "Decision recorded." })).toBeVisible();

    await p.goto(`/appeals/${appealId}`);
    await expect(p.getByTestId("outcome")).toContainText("Your review is live again");
    await p.goto(`/decisions/${s.caseId}`);
    await expect(p.getByTestId("notice-restored")).toBeVisible(); // CONTENT_RESTORED
    await page.goto(`/products/${PRODUCT_SLUG}`);
    await expect(page.getByRole("heading", { level: 3, name: s.title, exact: true })).toBeVisible();
  });

  test("E2E-005 a violation shows the statement of reasons and the appeal link until appealableUntil, then no link", async ({ browser, baseURL }) => {
    const s = await seedHeldReview(browser, baseURL, inHours(72));
    const soon = new Date(Date.now() + 20_000);
    await prisma.moderationCase.update({ where: { id: s.caseId }, data: { status: "RESOLVED", state: "REJECTED", outcome: "REMOVE", resolvedAt: new Date(), openKey: null, decisionReason: "Contains abusive language.", appealableUntil: soon } });
    await prisma.review.update({ where: { id: s.reviewId }, data: { status: "REJECTED" } });
    const p = await s.context.newPage();
    await p.goto(`/decisions/${s.caseId}`);
    await expect(p.getByTestId("notice-reason")).toContainText("Contains abusive language.");
    await expect(p.getByTestId("appeal-link")).toBeVisible();
    await expect(async () => {
      await p.reload();
      await expect(p.getByTestId("appeal-closed")).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000, intervals: [3_000] });
    await expect(p.getByTestId("appeal-link")).toHaveCount(0);
    await expect(p.getByTestId("appeal-closed")).toContainText("The appeal period ended on");
  });
});
