import { createHmac, randomBytes } from "node:crypto";
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

// ---- M3-06 seller flows -----------------------------------------------------------------------------------------------
/** Mailpit (docker compose `mailpit`, ADR-0016) is the dev/E2E mail sink; its HTTP API lets tests read the links the worker sent. */
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? "http://localhost:8025";

/** Polls Mailpit for a mail to `to` containing a link whose path matches `pathRe`; returns that link's path + query. */
export async function mailLinkFor(request: APIRequestContext, to: string, pathRe: RegExp): Promise<string> {
  let found = "";
  await expect.poll(
    async () => {
      const list = await request.get(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
      if (!list.ok()) return `mailpit ${list.status()}`;
      const { messages } = (await list.json()) as { messages?: { ID: string }[] };
      for (const m of messages ?? []) {
        const body = (await (await request.get(`${MAILPIT_URL}/api/v1/message/${m.ID}`)).json()) as { Text?: string; HTML?: string };
        const hit = `${body.Text ?? ""}\n${body.HTML ?? ""}`.match(/https?:\/\/[^\s"'<>]+/g)?.map((u) => new URL(u)).find((u) => pathRe.test(u.pathname));
        if (hit) { found = hit.pathname + hit.search; return "ok"; }
      }
      return "no mail yet";
    },
    { timeout: 60_000, intervals: [1_000, 2_000, 3_000], message: `mail to ${to} with a link matching ${pathRe}` },
  ).toBe("ok");
  return found;
}

/** Registers a user, confirms the email through the link in the mailed message (UI), and returns a signed-in context. */
export async function newVerifiedUser(browser: Browser, baseURL: string | undefined, tag = uniqueTag()) {
  const context = await browser.newContext({ baseURL });
  const user = await registerUser(context.request, newUser(tag));
  const link = await mailLinkFor(context.request, user.email, /\/verify-email$/);
  const page = await context.newPage();
  await page.goto(link);
  // T-02: confirming the email forces a new password; the account's password becomes USER_PASSWORD.
  await page.getByLabel("Choose a new password").fill(user.password);
  await page.getByRole("button", { name: "Confirm email" }).click();
  await expect(page.getByText("Your email is confirmed.")).toBeVisible();
  await signInInContext(context, user.email, user.password);
  return { context, page, user };
}

/** Creates a seller through the /sellers/new form; returns its id (from the dashboard URL). */
export async function createSellerViaUi(page: Page, name: string): Promise<string> {
  await page.goto("/sellers/new");
  await page.getByLabel(/Seller name/).fill(name);
  await page.getByRole("button", { name: "Create seller" }).click();
  await page.waitForURL(/\/seller\/[^/]+$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

// ---- Two-factor helpers (M3b-07) ----

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(s: string): Buffer {
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const ch of s.replace(/[\s=]/g, "").toUpperCase()) {
    val = (val << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/**
 * RFC 6238 code generator for an enrolled account. The server rejects a replayed step (and accepts +-1 step), so each call
 * uses a step strictly after the last one used, waiting for the clock when that would be more than one step ahead.
 */
export class Totp {
  private last = 0;
  constructor(private readonly secret: Buffer) {}
  static fromKey(key: string) { return new Totp(base32Decode(key)); }
  async next(): Promise<string> {
    const step = Math.max(Math.floor(Date.now() / 30_000), this.last + 1);
    while (step > Math.floor(Date.now() / 30_000) + 1) await new Promise((r) => setTimeout(r, 1_000));
    this.last = step;
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(step));
    const h = createHmac("sha1", this.secret).update(msg).digest();
    const o = h[h.length - 1]! & 15;
    const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
    return String(n % 1_000_000).padStart(6, "0");
  }
}

/** Walks the /account/security/2fa/setup wizard for a signed-in page. Returns the authenticator and the recovery codes. */
export async function enrolTwoFactor(page: Page, password: string): Promise<{ totp: Totp; recoveryCodes: string[] }> {
  await page.goto("/account/security/2fa/setup");
  await page.getByLabel("Current password").fill(password);
  await page.getByRole("button", { name: "Start setup" }).click();
  const key = (await page.getByTestId("tf-secret").innerText()).replace(/\s/g, "");
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  const totp = Totp.fromKey(key);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Code").fill(await totp.next());
  await page.getByRole("button", { name: "Confirm code" }).click();
  const list = page.getByTestId("recovery-codes");
  await expect(list).toBeVisible();
  const recoveryCodes = (await list.getByRole("listitem").allInnerTexts()).map((c) => c.trim());
  expect(recoveryCodes.length).toBeGreaterThanOrEqual(8);
  await expect(page.getByRole("button", { name: "Finish" })).toBeDisabled(); // must tick "I saved these" first
  await page.getByLabel("I saved these recovery codes").check();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("heading", { name: "Two-step verification is on." })).toBeVisible();
  return { totp, recoveryCodes };
}

/** Password sign-in through the real /login form; stops at the second-factor page for enrolled accounts. */
export async function loginViaForm(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
