import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, createSellerViaUi, mailLinkFor, newUser, newVerifiedUser, registerUser, signInInContext, signedInContext, uniqueTag } from "./helpers";

// M3-06: seller UI journeys over the real stack (web + worker + MySQL + Redis + Mailpit). See e2e/README.md.
// The DNS verifier is mocked at the browser boundary: the worker's real DNS/HTTP egress is SSRF-guarded and cannot be
// pointed at a test domain, so the test fakes only the status response the wizard polls. The point it proves is that
// the public badge never follows that response (no client-side trust).

test.describe("sellers (M3-06)", () => {
  test("E2E-SEL-1 creating a seller: dashboard for the owner, public page not verified", async ({ browser, baseURL }) => {
    const { context, page } = await newVerifiedUser(browser, baseURL);
    const name = `Acme ${uniqueTag()}`;
    const id = await createSellerViaUi(page, name);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
    await expect(page.getByText("Start verification")).toBeVisible();
    expect(id).toBeTruthy();
    await page.goto((await page.getByRole("link", { name: "View public page" }).getAttribute("href"))!);
    await expect(page.getByTestId("seller-unverified")).toBeVisible();
    await expect(page.getByTestId("seller-verified-badge")).toHaveCount(0);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    await context.close();
  });

  test("E2E-SEL-2 DNS claim against a mocked verifier: UI follows it, the public badge does not", async ({ browser, baseURL }) => {
    const { context, page } = await newVerifiedUser(browser, baseURL);
    const tag = uniqueTag();
    const id = await createSellerViaUi(page, `Dns Shop ${tag}`);
    const slugHref = await page.getByRole("link", { name: "View public page" }).getAttribute("href");

    await page.goto(`/seller/${id}/verification`);
    await page.getByLabel("DNS TXT record").check();
    await page.getByLabel(/^Domain/).fill(`shop-${tag}.com`);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText(`_rp-verify.shop-${tag}.com`)).toBeVisible();
    await expect(page.getByText(/^rp-verify=/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Copy Value/ })).toBeVisible();
    await expect(page.getByTestId("claim-status")).toHaveText("Pending");

    // Mock verifier: status polling reports VERIFIED. Only GET is intercepted; the POST above already hit the real API.
    await page.route(`**/api/sellers/${id}/claims`, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: { items: [{ id: "mock", method: "DNS_TXT", status: "VERIFIED", domain: `shop-${tag}.com`, challengeExpiresAt: null, lastCheckOutcome: "PASS", lastCheckAt: new Date().toISOString(), verifiedUntil: "2099-01-01T00:00:00Z" }] } })
        : route.fallback(),
    );
    await page.getByRole("button", { name: "Check status" }).click();
    await expect(page.getByTestId("claim-status")).toHaveText("Verified");

    // Server state is unchanged (worker never saw the proof), so the server-rendered public page shows no badge.
    await page.goto(slugHref!);
    await expect(page.getByTestId("seller-verified-badge")).toHaveCount(0);
    await expect(page.getByText(/^Verified:/)).toHaveCount(0);
    await context.close();
  });

  test("E2E-SEL-3 invitation: owner invites, invitee accepts and joins as responder", async ({ browser, baseURL }) => {
    const owner = await newVerifiedUser(browser, baseURL);
    const invitee = await newVerifiedUser(browser, baseURL);
    const id = await createSellerViaUi(owner.page, `Team Shop ${uniqueTag()}`);

    await owner.page.getByLabel("Email address").fill(invitee.user.email);
    await owner.page.getByLabel("Role").selectOption("RESPONDER");
    await owner.page.getByRole("button", { name: "Send invitation" }).click();
    await expect(owner.page.getByText("Invitation sent.")).toBeVisible();

    const link = await mailLinkFor(invitee.context.request, invitee.user.email, /\/invitations\/accept$/);
    await invitee.page.goto(link);
    await invitee.page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(invitee.page.getByText("You have joined the team.")).toBeVisible();
    await invitee.page.getByRole("link", { name: "Open seller dashboard" }).click();
    await expect(invitee.page).toHaveURL(new RegExp(`/seller/${id}$`));
    await expect(invitee.page.getByText("Invite a member")).toHaveCount(0); // responders do not see invite controls
    await expect(invitee.page.getByRole("row", { name: new RegExp(`${invitee.user.displayName}.*Responder`) })).toBeVisible();

    // Single-use: replaying the token fails with the generic message.
    await invitee.page.goto(link);
    await invitee.page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(invitee.page.getByRole("alert")).toContainText("invalid or has expired");
    await owner.context.close();
    await invitee.context.close();
  });

  test("E2E-SEL-4 admin approves a document claim from the queue", async ({ browser, baseURL }) => {
    const owner = await newVerifiedUser(browser, baseURL);
    const name = `Doc Shop ${uniqueTag()}`;
    const id = await createSellerViaUi(owner.page, name);
    await owner.page.goto(`/seller/${id}/verification`);
    await owner.page.getByLabel("Documents").check();
    await owner.page.getByRole("button", { name: "Continue" }).click();
    await expect(owner.page.getByTestId("claim-status")).toHaveText("Pending");

    const adminCtx = await signedInContext(browser, baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);
    const admin = await adminCtx.newPage();
    await admin.goto("/admin/seller-claims");
    const row = admin.getByRole("row", { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /^Approve claim/ }).click();
    await expect(admin.getByRole("status").filter({ hasText: /Claim approved|moved to contested/ })).toBeVisible();
    await expect(admin.getByRole("row", { name: new RegExp(name) })).toHaveCount(0);

    await owner.page.getByRole("button", { name: "Check status" }).click();
    await expect(owner.page.getByTestId("claim-status")).toHaveText("Verified");
    await owner.context.close();
    await adminCtx.close();
  });

  test("E2E-SEL-5 non-admins are redirected from the claims queue; unverified users see the banner", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    const user = await registerUser(context.request, newUser());
    await signInInContext(context, user.email, user.password);
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByTestId("email-banner")).toBeVisible();
    await page.goto("/admin/seller-claims");
    await expect(page).toHaveURL(/\/$/);
    await context.close();
  });
});
