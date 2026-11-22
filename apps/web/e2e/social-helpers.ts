import { prisma } from "@rp/db";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PRODUCT_SLUG, enrolTwoFactor, newUser, registerUser, signInInContext, uniqueTag, type TestUser, type Totp } from "./helpers";

/** A published review by a fresh author, written straight to the database (moderation is covered by review-flow.spec.ts). */
export async function seedPublishedReview(slug = PRODUCT_SLUG) {
  const tag = uniqueTag();
  const author = await prisma.user.create({ data: { email: `e2e-author-${tag}@example.com`, handle: `e2e_a_${tag}`, displayName: `Author ${tag}`, emailVerifiedAt: new Date() } });
  const product = await prisma.product.findFirstOrThrow({ where: { slug }, select: { id: true } });
  const title = `Seeded review ${tag}`;
  const review = await prisma.review.create({
    data: { productId: product.id, authorId: author.id, rating: 4, title, body: "Comfortable for long flights and the noise cancelling blocks the engine hum well.", status: "PUBLISHED", publishedVersion: 1, publishedAt: new Date() },
  });
  return { author, reviewId: review.id, title };
}

/** Marks an API-registered account as email-verified (DB write on the test's own row), so vote/report are allowed. */
export async function verifyEmailInDb(email: string) {
  return prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
}

export interface StaffActor { context: BrowserContext; page: Page; user: TestUser; id: string; totp: Totp }

/**
 * A staff account that enrols 2FA through the real setup wizard (DEF-LIVE-05: no bypass). The role row is written to the
 * test's own user before sign-in; enrolling in the same session leaves it second-factor verified.
 */
export async function makeStaffWith2fa(browser: Browser, baseURL: string | undefined, role: "ADMIN" | "SUPER_ADMIN" | "MODERATOR"): Promise<StaffActor> {
  const context = await browser.newContext({ baseURL });
  const user = await registerUser(context.request, newUser(`st${uniqueTag()}`));
  const row = await prisma.user.update({ where: { email: user.email }, data: { emailVerifiedAt: new Date(), roles: { create: { role, reason: "e2e" } } } });
  await signInInContext(context, user.email, user.password);
  const page = await context.newPage();
  const { totp } = await enrolTwoFactor(page, user.password);
  return { context, page, user, id: row.id, totp };
}

/** Fresh step-up (password + current TOTP) through the same endpoint the UI uses; needed for role grant and approval. */
export async function stepUpViaApi(s: StaffActor): Promise<void> {
  const res = await s.context.request.post("/api/auth/step-up", { data: { password: s.user.password, code: await s.totp.next() } });
  expect(res.ok(), `step-up ${res.status()} ${await res.text()}`).toBeTruthy();
}
