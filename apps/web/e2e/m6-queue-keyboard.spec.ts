import { expect, test } from "@playwright/test";
import { makeStaff, seedHeldReview } from "./m6-helpers";

test.describe("M6 staff queue keyboard path", () => {
  test("A11Y-004 J moves through the queue, A approves, and shortcuts can be switched off (WCAG 2.1.4)", async ({ browser, baseURL }) => {
    const s = await seedHeldReview(browser, baseURL, new Date(Date.now() + 72 * 3_600_000));
    const mod = await makeStaff(browser, baseURL);
    const p = await mod.context.newPage();
    await p.goto("/admin/moderation");
    await expect(p.locator("li", { hasText: s.title })).toBeVisible();
    await p.keyboard.press("j");
    await expect(p.getByRole("status").filter({ hasText: /Item 1 of/ })).toBeVisible();
    await p.keyboard.press("Enter"); // opens the focused item (native button)
    await expect(p.getByRole("button", { name: "Approve" })).toBeVisible();
    await p.getByLabel("Keyboard shortcuts").uncheck();
    await p.getByRole("button", { name: "Approve" }).focus();
    await p.keyboard.press("a");
    await expect(p.getByRole("status").filter({ hasText: "Case approved." })).toHaveCount(0); // off switch honoured
    await p.getByLabel("Keyboard shortcuts").check();
    await p.locator("body").click({ position: { x: 1, y: 1 } });
    await p.keyboard.press("a");
    await expect(p.getByRole("status").filter({ hasText: "Case approved." })).toBeVisible();
  });
});
