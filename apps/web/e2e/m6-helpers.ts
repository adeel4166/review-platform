import { prisma } from "@rp/db";
import { expect, type Browser, type BrowserContext } from "@playwright/test";
import { PRODUCT_SLUG, newUser, registerUser, signInInContext, uniqueTag, type TestUser } from "./helpers";

/**
 * M6 journeys seed their own deadlines straight into the database (ADR-0024: no runtime test clock). The tests only ever write
 * rows they created themselves (unique tags), so they stay parallel-safe. Needs DATABASE_URL in the Playwright environment.
 */
export async function makeStaff(browser: Browser, baseURL: string | undefined): Promise<{ context: BrowserContext; user: TestUser; id: string }> {
  const context = await browser.newContext({ baseURL });
  const user = await registerUser(context.request, newUser(`mod${uniqueTag()}`));
  const row = await prisma.user.update({ where: { email: user.email }, data: { emailVerifiedAt: new Date(), roles: { create: { role: "ADMIN", reason: "e2e" } } } });
  await signInInContext(context, user.email, user.password);
  return { context, user, id: row.id };
}

/** An author with a PENDING review and an OPEN hold-lane case (UNSURE verdict). `holdExpiresAt` is absolute UTC. */
export async function seedHeldReview(browser: Browser, baseURL: string | undefined, holdExpiresAt: Date) {
  const context = await browser.newContext({ baseURL });
  const author = await registerUser(context.request, newUser(`au${uniqueTag()}`));
  const a = await prisma.user.update({ where: { email: author.email }, data: { emailVerifiedAt: new Date() } });
  await signInInContext(context, author.email, author.password);
  const product = await prisma.product.findFirstOrThrow({ where: { slug: PRODUCT_SLUG }, select: { id: true } });
  const title = `Held review ${uniqueTag()}`;
  const review = await prisma.review.create({ data: { productId: product.id, authorId: a.id, rating: 3, title, body: "Honestly this feels like a scam next to the brand's own site, but the sound is decent.", status: "PENDING" } });
  const c = await prisma.moderationCase.create({
    data: { reviewId: review.id, version: 1, state: "NEEDS_HUMAN", status: "OPEN", lane: "HOLD", holdExpiresAt, aiVerdict: "UNSURE", openKey: `HOLD:R:${review.id}` },
  });
  return { context, author, authorId: a.id, reviewId: review.id, caseId: c.id, title };
}

/** Waits for the worker sweeper to resolve the case (hold expiry). */
export async function waitForResolved(caseId: string) {
  await expect.poll(async () => (await prisma.moderationCase.findUnique({ where: { id: caseId }, select: { status: true } }))?.status, { timeout: 120_000, intervals: [2_000, 3_000, 5_000], message: "sweeper resolves the expired hold" }).toBe("RESOLVED");
}
