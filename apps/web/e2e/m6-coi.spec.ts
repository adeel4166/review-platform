import { expect, test } from "@playwright/test";
import { makeStaff, seedHeldReview } from "./m6-helpers";
import { prisma } from "@rp/db";

test.describe("M6 conflict of interest", () => {
  test("E2E-008 a moderator sees no decide control on their own review and a direct API call returns CONFLICT_OF_INTEREST", async ({ browser, baseURL }) => {
    const mod = await makeStaff(browser, baseURL);
    const s = await seedHeldReview(browser, baseURL, new Date(Date.now() + 72 * 3_600_000));
    // Make the staff member the author of the held review.
    await prisma.review.update({ where: { id: s.reviewId }, data: { authorId: mod.id } });
    const p = await mod.context.newPage();
    await p.goto("/admin/moderation");
    await p.locator("li", { hasText: s.title }).getByRole("button", { name: /Open/ }).click();
    await expect(p.getByTestId("coi-banner")).toBeVisible();
    await expect(p.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(p.getByRole("button", { name: "Reject" })).toHaveCount(0);
    for (const action of ["approve", "reject"]) {
      const res = await mod.context.request.post(`/api/admin/moderation/${s.caseId}/${action}`, { data: { reason: "own review attempt" } });
      expect(res.status()).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("CONFLICT_OF_INTEREST");
    }
  });
});
