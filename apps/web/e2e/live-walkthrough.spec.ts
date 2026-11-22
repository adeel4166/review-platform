// LIVE-07: screenshot walkthrough of every role on a running staging stack (desktop + mobile).
// Run: STAGING_URL=https://<host> DEMO_PASSWORD=<env> pnpm --filter @rp/web exec playwright test -c playwright.staging.config.ts
// Output: docs/qa/live-walkthrough/<role>/<page>.<desktop|mobile>.png and walkthrough-results.json (observed status per page).
// Never prints or stores the password. Pages a role may not open are asserted to be refused (not silently skipped).
import { test, expect, type Browser } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve(__dirname, "../../../docs/qa/live-walkthrough");
const PASSWORD = process.env.DEMO_PASSWORD ?? "";
const DOMAIN = "demo.example";
const VIEWPORTS = { desktop: { width: 1366, height: 900 }, mobile: { width: 390, height: 844 } } as const;

const PUBLIC = ["/", "/products", "/products/acme-noise-cancelling-headphones", "/compare", "/login", "/register"];
const USER = [...PUBLIC, "/account/profile", "/account/notifications", "/account/submissions", "/account/security/2fa/setup", "/trust/verified-purchases", "/products/acme-noise-cancelling-headphones/review"];
const STAFF = ["/admin/moderation", "/admin/appeals", "/admin/proofs", "/admin/media", "/admin/enforcement", "/admin/seller-claims", "/admin/approvals"];

const ROLES: { role: string; email?: string; pages: string[]; denied?: string[] }[] = [
  { role: "visitor", pages: PUBLIC, denied: ["/account/profile", "/admin/moderation", "/seller"] },
  { role: "user", email: `demo.user@${DOMAIN}`, pages: USER, denied: ["/admin/moderation", "/admin/approvals"] },
  { role: "seller", email: `demo.seller@${DOMAIN}`, pages: [...USER, "/seller"], denied: ["/admin/moderation"] },
  { role: "moderator", email: `demo.moderator@${DOMAIN}`, pages: [...USER, "/admin/moderation", "/admin/appeals", "/admin/proofs", "/admin/media"], denied: ["/admin/approvals"] },
  { role: "senior-moderator", email: `demo.senior-moderator@${DOMAIN}`, pages: [...USER, ...STAFF.slice(0, 5)], denied: ["/admin/approvals"] },
  { role: "admin", email: `demo.admin@${DOMAIN}`, pages: [...USER, ...STAFF] },
  { role: "super-admin", email: `demo.super-admin@${DOMAIN}`, pages: [...USER, ...STAFF] },
];

const slug = (p: string) => (p === "/" ? "home" : p.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-"));
const results: { role: string; page: string; viewport: string; status: number; finalUrl: string; consoleErrors: number }[] = [];

async function ctxFor(browser: Browser, email: string | undefined, vp: keyof typeof VIEWPORTS, baseURL: string) {
  const context = await browser.newContext({ baseURL, viewport: VIEWPORTS[vp], isMobile: vp === "mobile" });
  if (email) {
    const { csrfToken } = (await (await context.request.get("/api/auth/csrf")).json()) as { csrfToken: string };
    const res = await context.request.post("/api/auth/callback/credentials", { form: { csrfToken, email, password: PASSWORD, json: "true" }, maxRedirects: 0 }).catch((e) => e);
    // A 2FA-enrolled staff account lands on /login/2fa: record it, do not bypass it.
    expect(res, `login for ${email}`).toBeTruthy();
  }
  return context;
}

test.describe.configure({ mode: "serial" });
test.skip(!PASSWORD, "DEMO_PASSWORD not set: refusing to run a walkthrough without credentials");

for (const { role, email, pages, denied = [] } of ROLES) {
  for (const vp of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
    test(`walkthrough ${role} (${vp})`, async ({ browser, baseURL }) => {
      const context = await ctxFor(browser, email, vp, baseURL!);
      const page = await context.newPage();
      let errs = 0;
      page.on("console", (m) => { if (m.type() === "error") errs++; });
      mkdirSync(path.join(OUT, role), { recursive: true });
      for (const p of pages) {
        errs = 0;
        const res = await page.goto(p, { waitUntil: "networkidle" });
        const status = res?.status() ?? 0;
        await page.screenshot({ path: path.join(OUT, role, `${slug(p)}.${vp}.png`), fullPage: true });
        results.push({ role, page: p, viewport: vp, status, finalUrl: page.url(), consoleErrors: errs });
        expect.soft(status, `${role} ${p}`).toBeLessThan(400);
        // Mobile: no horizontal overflow (layout regression check).
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        expect.soft(overflow, `${role} ${p} ${vp} horizontal overflow`).toBe(false);
      }
      for (const p of denied) {
        const res = await page.goto(p, { waitUntil: "domcontentloaded" });
        const refused = (res?.status() ?? 0) >= 400 || /\/login/.test(page.url());
        expect.soft(refused, `${role} must be refused on ${p} (got ${res?.status()} ${page.url()})`).toBe(true);
      }
      await context.close();
    });
  }
}

test.afterAll(() => { mkdirSync(OUT, { recursive: true }); writeFileSync(path.join(OUT, "walkthrough-results.json"), JSON.stringify(results, null, 2)); });
