import { randomBytes } from "node:crypto";
import { expect, type Browser, type BrowserContext, type APIRequestContext, type Page } from "@playwright/test";

/** Seeded admin (packages/db/prisma/seed.ts). The password must match SEED_ADMIN_PASSWORD used when seeding. */
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
export const ADMIN_PASSWORD = requiredEnv("E2E_ADMIN_PASSWORD");

/** Password for users created by the tests. Test fixture only, never used outside the throwaway test database. */
export const USER_PASSWORD = "e2e-test-password-123";

export const PRODUCT_SLUG = "acme-noise-cancelling-headphones";
export const REVIEW_PATH = `/products/${PRODUCT_SLUG}/review`;

// Mock moderation provider (packages/core/src/moderation-provider.ts) decides by content, so tests pick text:
// clean text (>= 20 chars, no blocklist words) -> APPROVED; one blocklist word -> NEEDS_HUMAN;
// two blocklist words -> REJECTED.
export const CLEAN_BODY = "Comfortable for long flights and the noise cancelling blocks the engine hum well.";
export const UNSURE_BODY = "Honestly this feels like a scam next to the brand's own site, but the sound is decent.";
export const REJECT_BODY = "Total scam and fraud from start to finish, do not buy.";

export function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}: set it to the password used when seeding (see docs in e2e/README.md)`);
  return v;
}

/** Unique suffix so parallel tests never share users, emails or review titles. */
export function uniqueTag(): string {
  return randomBytes(4).toString("hex");
}

export interface TestUser {
  email: string;
  password: string;
  handle: string;
  displayName: string;
}

export function newUser(tag = uniqueTag()): TestUser {
  return { email: `e2e-${tag}@example.com`, password: USER_PASSWORD, handle: `e2e_${tag}`, displayName: `E2E ${tag}` };
}

/** Creates an account through the public registration API (there is no registration page yet). */
export async function registerUser(request: APIRequestContext, user: TestUser = newUser()): Promise<TestUser> {
  const res = await request.post("/api/auth/register", {
    data: { email: user.email, password: user.password, handle: user.handle, displayName: user.displayName },
  });
  expect(res.status(), await res.text()).toBe(202); // generic register response (SEC-05)
  return user;
}

/**
 * Signs in through Auth.js' credentials endpoint and leaves the session cookie in the context's cookie jar.
 * The /login page does not exist yet, so this goes through the same endpoint the form would post to.
 */
export async function signInInContext(context: BrowserContext, email: string, password: string): Promise<void> {
  const csrf = await context.request.get("/api/auth/csrf");
  expect(csrf.ok()).toBeTruthy();
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const res = await context.request.post("/api/auth/callback/credentials", {
    form: { csrfToken, email, password, json: "true" },
  });
  expect(res.ok(), "credentials sign-in request").toBeTruthy();
  const session = await context.request.get("/api/auth/session");
  const body = (await session.json()) as { user?: { id?: string; role?: string } };
  expect(body.user?.id, "session has a user after sign-in").toBeTruthy();
}

/** A fresh browser context signed in as the given user, so each actor has an isolated cookie jar. */
export async function signedInContext(browser: Browser, baseURL: string | undefined, email: string, password: string) {
  const context = await browser.newContext({ baseURL });
  await signInInContext(context, email, password);
  return context;
}

/** A new account (registered through the API) with its own signed-in browser context. Caller closes the context. */
export async function newSignedInUser(browser: Browser, baseURL: string | undefined, tag = uniqueTag()) {
  const context = await browser.newContext({ baseURL });
  const user = await registerUser(context.request, newUser(tag));
  await signInInContext(context, user.email, user.password);
  return { context, user };
}

/**
 * Fills in and submits the review form. Optionally attaches one small PNG.
 * Returns the id of the created review (taken from the API response).
 */
export async function submitReview(
  page: Page,
  review: { rating: number; title: string; body: string; photo?: boolean },
): Promise<string> {
  await page.goto(REVIEW_PATH);
  await page.getByRole("radio", { name: `${review.rating} star${review.rating === 1 ? "" : "s"}` }).check();
  await page.getByLabel("Title").fill(review.title);
  await page.getByLabel("Your review").fill(review.body);
  if (review.photo) {
    await page.locator("#photos").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });
  }
  const [created] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/products\/[^/]+\/reviews$/.test(new URL(r.url()).pathname)),
    page.getByRole("button", { name: "Submit review" }).click(),
  ]);
  expect(created.status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Thanks! Your review is pending moderation" })).toBeVisible();
  return ((await created.json()) as { id: string }).id;
}

/** Smallest valid PNG (1x1), so the upload passes the content checks without a fixture file in the repo. */
export const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Public product page shows the review title once it is PUBLISHED. Reloads until it appears or the timeout hits. */
export async function expectPublicReview(page: Page, title: string): Promise<void> {
  await expect(async () => {
    await page.goto(`/products/${PRODUCT_SLUG}`);
    await expect(page.getByRole("heading", { level: 3, name: title, exact: true })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000, intervals: [2_000, 3_000, 5_000] });
}

/** A review must not be visible on the public product page. Checked after the moderation queue has drained. */
export async function expectNotPublic(page: Page, title: string): Promise<void> {
  await page.goto(`/products/${PRODUCT_SLUG}`);
  await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
}

/** Waits until the admin API lists the review's case in the given state (moderation runs asynchronously). */
export async function waitForCaseState(admin: APIRequestContext, state: string, title: string): Promise<void> {
  await expect.poll(
    async () => {
      const res = await admin.get(`/api/admin/moderation?state=${state}&pageSize=50`);
      if (!res.ok()) return `http ${res.status()}`;
      const body = (await res.json()) as { items: { review: { title: string } }[] };
      return body.items.some((i) => i.review.title === title);
    },
    { timeout: 90_000, intervals: [2_000, 3_000, 5_000], message: `case for "${title}" reaches ${state}` },
  ).toBe(true);
}
