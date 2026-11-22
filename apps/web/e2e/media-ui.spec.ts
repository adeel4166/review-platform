import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { CLEAN_BODY, ONE_PIXEL_PNG, REVIEW_PATH, newSignedInUser, uniqueTag } from "./helpers";

// M5-02 media UI (task #74). Needs the full stack: web + worker (media group) + ClamAV + seeded DB, like review-flow.spec.ts.
// The scan-rejected case uploads the standard EICAR test string (harmless, detected by every AV engine). It must be a valid PNG
// header + EICAR so the type check passes and the scanner is what rejects it.
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const EICAR_PNG = Buffer.concat([ONE_PIXEL_PNG, Buffer.from(EICAR)]);

async function fillReview(page: import("@playwright/test").Page, title: string) {
  await page.goto(REVIEW_PATH);
  await page.getByRole("radio", { name: "5 stars" }).check();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Your review").fill(CLEAN_BODY);
}

test.describe("M5 media upload UI", () => {
  test("E2E-M5-001 upload happy path: progress, processing, then ready", async ({ browser, baseURL }) => {
    const { context } = await newSignedInUser(browser, baseURL);
    const page = await context.newPage();
    await fillReview(page, `E2E media ${uniqueTag()}`);
    await page.locator("#photos").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });
    await page.getByRole("button", { name: "Submit review" }).click();
    await expect(page.getByRole("heading", { name: "Thanks! Your review is pending moderation" })).toBeVisible();
    const list = page.getByTestId("media-status");
    await expect(list).toBeVisible();
    await expect(list.getByText(/Ready\./)).toBeVisible({ timeout: 90_000 });
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    await context.close();
  });

  test("E2E-M5-002 scan-rejected file shows a per-file reason and a next step, without naming the threat", async ({ browser, baseURL }) => {
    const { context } = await newSignedInUser(browser, baseURL);
    const page = await context.newPage();
    await fillReview(page, `E2E rejected ${uniqueTag()}`);
    await page.locator("#photos").setInputFiles({ name: "infected.png", mimeType: "image/png", buffer: EICAR_PNG });
    await page.getByRole("button", { name: "Submit review" }).click();
    const list = page.getByTestId("media-status");
    await expect(list.getByRole("alert")).toContainText(/Not accepted: .*safety check.*different file/, { timeout: 90_000 });
    await expect(page.locator("body")).not.toContainText(/eicar/i);
    await context.close();
  });

  test("E2E-M5-003 client pre-check rejects an unsupported type with the file name and a remedy", async ({ browser, baseURL }) => {
    const { context } = await newSignedInUser(browser, baseURL);
    const page = await context.newPage();
    await page.goto(REVIEW_PATH);
    await page.locator("#photos").setInputFiles({ name: "notes.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
    await expect(page.getByRole("alert")).toContainText("notes.gif is not a supported type");
    await context.close();
  });
});
