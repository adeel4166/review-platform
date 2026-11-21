import { expect, test } from "@playwright/test";
import { createSellerViaUi, enrolTwoFactor, mailLinkFor, newVerifiedUser, uniqueTag } from "./helpers";

// M3b-07: an OWNER asks a MANAGER to become co-owner, sees the 72 h countdown, then cancels the change.

test.describe("ownership transfer (M3b-07)", () => {
  test("E2E-OWN-1 request an ownership change, see the countdown, cancel it", async ({ browser, baseURL }) => {
    const owner = await newVerifiedUser(browser, baseURL);
    const manager = await newVerifiedUser(browser, baseURL);
    await enrolTwoFactor(manager.page, manager.user.password); // the target must have 2FA before a request is accepted
    const { totp } = await enrolTwoFactor(owner.page, owner.user.password);
    await createSellerViaUi(owner.page, `Own Shop ${uniqueTag()}`);

    await owner.page.getByLabel("Email address").fill(manager.user.email);
    await owner.page.getByLabel("Role").selectOption("MANAGER");
    await owner.page.getByRole("button", { name: "Send invitation" }).click();
    await expect(owner.page.getByText("Invitation sent.")).toBeVisible();
    const link = await mailLinkFor(manager.context.request, manager.user.email, /\/invitations\/accept$/);
    await manager.page.goto(link);
    await expect(manager.page).toHaveURL(/\/invitations\/accept$/); // T-07: the token is removed from the address bar
    await manager.page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(manager.page.getByText("You have joined the team.")).toBeVisible();

    await owner.page.reload();
    const panel = owner.page.getByRole("region", { name: "Ownership" }).or(owner.page.locator("section[aria-labelledby=own-h]"));
    await expect(panel.getByText("No ownership change in progress.")).toBeVisible();
    await panel.getByLabel("Change", { exact: true }).selectOption("ADD_OWNER");
    await panel.getByLabel("New owner").selectOption({ label: `${manager.user.displayName} (@${manager.user.handle})` });
    await panel.getByLabel("Current password").fill(owner.user.password);
    await panel.getByLabel("Code").fill(await totp.next());
    await panel.getByRole("button", { name: "Request change" }).click();
    await expect(panel.getByTestId("own-msg")).toContainText("Ownership change requested");

    const open = panel.getByTestId("own-open");
    await expect(open).toHaveCount(1);
    await expect(open.getByTestId("own-countdown")).toContainText(/Takes effect in 2d/);
    await expect(open).toContainText("Waiting for the new owner to accept");

    await open.getByRole("button", { name: /^Cancel Add owner for/ }).click();
    await expect(panel.getByTestId("own-msg")).toContainText("Ownership change cancelled.");
    await expect(panel.getByText("No ownership change in progress.")).toBeVisible();
    await expect(panel.getByTestId("own-open")).toHaveCount(0);
    await owner.context.close();
    await manager.context.close();
  });
});
