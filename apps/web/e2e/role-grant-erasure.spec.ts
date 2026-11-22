import { expect, test } from "@playwright/test";
import { prisma } from "@rp/db";
import { enrolTwoFactor, newVerifiedUser } from "./helpers";
import { makeStaffWith2fa, stepUpViaApi } from "./social-helpers";

// DEF-LIVE-03: four-eyes role grant on /admin/approvals and account erasure. Staff enrol 2FA in-test (DEF-LIVE-05, no bypass).

test.describe("four-eyes role grant (DEF-LIVE-03)", () => {
  test("E2E-4EYE-1 requester cannot self-approve; a second SUPER_ADMIN approves and the role is granted", async ({ browser, baseURL }) => {
    const requester = await makeStaffWith2fa(browser, baseURL, "SUPER_ADMIN");
    const approver = await makeStaffWith2fa(browser, baseURL, "SUPER_ADMIN");
    const target = await newVerifiedUser(browser, baseURL);
    await enrolTwoFactor(target.page, target.user.password); // target must hold 2FA before a grant is accepted
    const targetRow = await prisma.user.findUniqueOrThrow({ where: { email: target.user.email }, select: { id: true } });

    await stepUpViaApi(requester);
    const req = await requester.context.request.post(`/api/admin/staff/${targetRow.id}/roles`, { data: { role: "ADMIN", reason: "e2e four-eyes grant" } });
    expect(req.status(), await req.text()).toBe(202);
    const { approvalRequestId } = (await req.json()) as { approvalRequestId: string };
    expect(await prisma.userRole.count({ where: { userId: targetRow.id, role: "ADMIN" } }), "nothing granted before approval").toBe(0);

    // Requester: sees the request but no approve button; the API refuses too.
    await requester.page.goto("/admin/approvals");
    const mine = requester.page.getByTestId("approval-row").filter({ hasText: targetRow.id });
    await expect(mine).toContainText("Grant staff role");
    await expect(mine).toContainText("You requested this. Another admin must decide.");
    await expect(mine.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await stepUpViaApi(requester);
    const self = await requester.context.request.post(`/api/admin/approvals/${approvalRequestId}/approve`, { data: {} });
    expect(self.status()).toBe(403);
    expect(await self.text()).toContain("approval_self");
    expect(await prisma.userRole.count({ where: { userId: targetRow.id, role: "ADMIN" } })).toBe(0);

    // Second SUPER_ADMIN approves through the UI.
    await stepUpViaApi(approver);
    await approver.page.goto("/admin/approvals");
    const row = approver.page.getByTestId("approval-row").filter({ hasText: targetRow.id });
    await expect(row.getByRole("button", { name: "Approve" })).toBeVisible();
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(approver.page.getByRole("status").filter({ hasText: "Approved. The change was applied." })).toBeVisible();
    await expect(row).toHaveCount(0);
    expect(await prisma.userRole.count({ where: { userId: targetRow.id, role: "ADMIN" } })).toBe(1);
    expect((await prisma.staffApprovalRequest.findUniqueOrThrow({ where: { id: approvalRequestId } })).decidedById).toBe(approver.id);

    for (const c of [requester.context, approver.context, target.context]) await c.close();
  });
});

test.describe("account erasure (DEF-LIVE-03)", () => {
  test("E2E-ERASE-1 a user erases their account: wrong confirmation refused, then 202, session ends, worker anonymises", async ({ browser, baseURL }) => {
    const { context, page, user } = await newVerifiedUser(browser, baseURL);
    // DEF-LIVE-08: there is no erasure UI yet (no page or component calls DELETE /api/account), so the journey is driven through the API from the signed-in browser.
    await page.goto("/account/profile");
    const step = await context.request.post("/api/auth/step-up", { data: { password: user.password } });
    expect(step.ok(), await step.text()).toBeTruthy();
    const wrong = await context.request.delete("/api/account", { data: { confirm: "not-my-handle" } });
    expect(wrong.status()).toBe(422);
    const ok = await context.request.delete("/api/account", { data: { confirm: user.handle } });
    expect(ok.status(), await ok.text()).toBe(202);
    const { erasureRequestId } = (await ok.json()) as { erasureRequestId: string };

    const session = (await (await context.request.get("/api/auth/session")).json()) as { user?: unknown };
    expect(session.user, "session ended").toBeFalsy();
    await expect.poll(async () => (await prisma.user.findFirst({ where: { email: user.email } })) === null, { timeout: 90_000, intervals: [2_000, 3_000, 5_000], message: "worker anonymises the e-mail" }).toBe(true);
    expect(await prisma.erasureRequest.findUnique({ where: { id: erasureRequestId } })).not.toBeNull();
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).not.toHaveURL(/\/account/);
    await context.close();
  });

  test.fixme("E2E-ERASE-2 account erasure through the UI (blocked by DEF-LIVE-08: no UI exists)", async () => {
    // Enable once /account has a 'Delete account' control: type the handle, confirm, expect the signed-out landing page.
  });
});
