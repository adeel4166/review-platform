import { expect, test } from "@playwright/test";
import { prisma } from "@rp/db";
import { newSignedInUser } from "./helpers";
import { seedPublishedReview, verifyEmailInDb } from "./social-helpers";

// DEF-LIVE-03: follow a user, and the notification inbox page.

test.describe("follow and notifications (DEF-LIVE-03)", () => {
  test("E2E-FOL-1 follow and unfollow a reviewer from their profile", async ({ browser, baseURL }) => {
    const { author } = await seedPublishedReview();
    const { context, user } = await newSignedInUser(browser, baseURL);
    await verifyEmailInDb(user.email);
    const page = await context.newPage();
    await page.goto(`/u/${author.handle}`);
    const btn = page.getByRole("button", { name: new RegExp(`Follow @${author.handle}`) });
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await btn.click();
    await expect(page.getByRole("status").filter({ hasText: `You now follow @${author.handle}.` })).toBeVisible();
    expect(await prisma.follow.count({ where: { followedUserId: author.id, follower: { email: user.email } } })).toBe(1);
    await page.reload();
    await expect(page.getByRole("button", { name: new RegExp(`@${author.handle}`) })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: new RegExp(`@${author.handle}`) }).click();
    await expect(page.getByRole("status").filter({ hasText: `You unfollowed @${author.handle}.` })).toBeVisible();
    expect(await prisma.follow.count({ where: { followedUserId: author.id, follower: { email: user.email } } })).toBe(0);
    await context.close();
  });

  test("E2E-FOL-2 the followed user gets a NEW_FOLLOWER notification in /account/notifications", async ({ browser, baseURL }) => {
    // DEF-LIVE-06/07 (docs/qa/live-gate-report.md): no producer emits NEW_FOLLOWER, and en.ts has no notif.type.* labels.
    test.fail(true, "DEF-LIVE-06/07: following does not notify; remove this annotation when fixed");
    const target = await newSignedInUser(browser, baseURL);
    const t = await verifyEmailInDb(target.user.email);
    const fan = await newSignedInUser(browser, baseURL);
    await verifyEmailInDb(fan.user.email);
    const put = await fan.context.request.put("/api/follows", { data: { targetType: "USER", targetId: t.id } });
    expect(put.ok(), await put.text()).toBeTruthy();
    const page = await target.context.newPage();
    await expect(async () => {
      await page.goto("/account/notifications");
      await expect(page.getByTestId("notification")).toHaveCount(1, { timeout: 3_000 });
    }).toPass({ timeout: 30_000, intervals: [2_000, 3_000] });
    await target.context.close();
    await fan.context.close();
  });

  test("E2E-NOT-1 /account/notifications requires sign-in and renders the inbox for a signed-in user", async ({ browser, baseURL, page }) => {
    await page.goto("/account/notifications");
    await expect(page).toHaveURL(/\/login/);
    const { context } = await newSignedInUser(browser, baseURL);
    const p = await context.newPage();
    const errors: string[] = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto("/account/notifications");
    await expect(p.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
    await expect(p.getByText("No notifications.")).toBeVisible();
    expect(errors, "no client-side exception (DEF-LIVE-07: missing notif.type.* labels crash the preferences table)").toEqual([]);
    await context.close();
  });
});
