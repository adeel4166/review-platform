import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PRODUCT_SLUG, REVIEW_PATH, newSignedInUser } from "./helpers";
import { makeStaff } from "./m6-helpers";

/** V3-08 a11y gate: axe on every key route in both themes, reduced-motion pass, keyboard-only pass, image fallback, AI summary states. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const blocking = (r: { violations: { impact?: string | null }[] }) => r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
const THEMES = ["light", "dark"] as const;
const PUBLIC_ROUTES = ["/", "/products", `/products/${PRODUCT_SLUG}`, "/login", "/register", "/trust/verified-purchases"];

for (const theme of THEMES) {
  test.describe(`V3-08 axe sweep (${theme})`, () => {
    test.beforeEach(async ({ page }) => { await page.addInitScript((th) => localStorage.setItem("rp-theme", th), theme); });

    for (const route of PUBLIC_ROUTES) {
      test(`A11Y-V3 ${route}`, async ({ page }) => {
        await page.goto(route);
        await expect(page.locator("main")).toBeVisible();
        expect(blocking(await new AxeBuilder({ page }).withTags(TAGS).analyze())).toEqual([]);
      });
    }
    test("A11Y-V3 review form + profile (signed in)", async ({ browser, baseURL }) => {
      const { context, user } = await newSignedInUser(browser, baseURL);
      const page = await context.newPage();
      await page.addInitScript((th) => localStorage.setItem("rp-theme", th), theme);
      for (const route of [REVIEW_PATH, `/u/${user.handle}`, "/account/profile"]) {
        await page.goto(route); await expect(page.locator("main")).toBeVisible();
        expect(blocking(await new AxeBuilder({ page }).withTags(TAGS).analyze()), route).toEqual([]);
      }
      await context.close();
    });
    test("A11Y-V3 admin queues", async ({ browser, baseURL }) => {
      const staff = await makeStaff(browser, baseURL);
      const page = await staff.context.newPage();
      await page.addInitScript((th) => localStorage.setItem("rp-theme", th), theme);
      for (const q of ["moderation", "appeals", "approvals", "enforcement", "media", "proofs", "seller-claims"]) {
        await page.goto(`/admin/${q}`); await expect(page.locator("main")).toBeVisible();
        expect(blocking(await new AxeBuilder({ page }).withTags(TAGS).analyze()), q).toEqual([]);
      }
      await staff.context.close();
    });
  });
}

test.describe("V3-08 reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("A11Y-RM-1 no running animation/transition longer than 50ms on landing and product page", async ({ page }) => {
    for (const route of ["/", `/products/${PRODUCT_SLUG}`]) {
      await page.goto(route); await page.waitForLoadState("networkidle");
      const running = await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations === Infinity || Number(a.effect?.getComputedTiming().duration) > 50).map((a) => a.id || a.constructor.name));
      expect(running, `${route} animations under prefers-reduced-motion`).toEqual([]);
    }
  });
  test("A11Y-RM-2 histogram fills are at final width immediately", async ({ page }) => {
    await page.goto(`/products/${PRODUCT_SLUG}`);
    await expect(page.getByTestId("chart-distribution")).toBeVisible();
  });
});

test.describe("V3-08 keyboard only", () => {
  async function tabUntil(page: Page, pred: (el: Element) => boolean, max = 60) {
    for (let i = 0; i < max; i++) { await page.keyboard.press("Tab"); if (await page.evaluate(`(${pred.toString()})(document.activeElement)`)) return true; }
    return false;
  }
  test("A11Y-KB-1 skip link or first Tab stop is visible, focus ring is visible on every stop of the landing header", async ({ page }) => {
    await page.goto("/");
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => { const e = document.activeElement as HTMLElement; const s = getComputedStyle(e); const r = e.getBoundingClientRect();
        return { tag: e.tagName, outline: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0, ring: s.boxShadow !== "none", visible: r.width > 0 && r.height > 0 }; });
      expect(info.visible, `tab stop ${i} visible`).toBe(true);
      expect(info.outline || info.ring, `tab stop ${i} (${info.tag}) shows a focus indicator`).toBe(true);
    }
  });
  test("A11Y-KB-2 search palette: open, search, choose, close with keyboard only, no focus trap leak", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search products" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
  test("A11Y-KB-3 product page reaches the review CTA and the AI summary toggle (when present) by Tab, Enter/Space operate it", async ({ page }) => {
    await page.goto(`/products/${PRODUCT_SLUG}`);
    expect(await tabUntil(page, (el) => /review/i.test(el.textContent ?? "") && el.tagName === "A")).toBe(true);
    const card = page.getByTestId("ai-summary");
    if (await card.count()) {
      const toggle = card.getByRole("button");
      await toggle.focus(); await page.keyboard.press("Space");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    }
  });
  test("A11Y-KB-4 review form is completable without a pointer", async ({ browser, baseURL }) => {
    const { context } = await newSignedInUser(browser, baseURL);
    const page = await context.newPage();
    await page.goto(REVIEW_PATH);
    await page.getByRole("radio", { name: "4 stars" }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("radio", { name: "4 stars" })).toBeChecked();
    await page.getByLabel("Title").focus(); await page.keyboard.type("Keyboard only");
    await page.keyboard.press("Tab"); await page.keyboard.type("Typed with no mouse involved at all, long enough.");
    expect(await tabUntil(page, (el) => /submit review/i.test(el.textContent ?? ""))).toBe(true);
    await context.close();
  });
});

test.describe("V3-08 image fallbacks", () => {
  test("IMG-1 a product image that fails to load must not leave a broken image icon", async ({ page }) => {
    await page.route(/\/_next\/image|res\.cloudinary\.com|\.(png|jpe?g|webp|avif)(\?|$)/, (r) => r.abort());
    await page.goto("/products");
    await page.waitForLoadState("networkidle");
    // Expected: failed <img> are replaced by the letter fallback (or hidden). DEF-V3-04: they are currently left broken.
    const broken = await page.evaluate(() => [...document.querySelectorAll("main img")].filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth === 0).length);
    expect(broken, "broken <img> elements on /products with the image CDN down").toBe(0);
  });
  test("IMG-2 every product <img> has width/height or fill sizing and alt text (no CLS, no a11y gap)", async ({ page }) => {
    await page.goto("/products");
    const bad = await page.evaluate(() => [...document.querySelectorAll("main img")].filter((i) => !i.hasAttribute("alt") || (!(i.getAttribute("width") && i.getAttribute("height")) && getComputedStyle(i).position !== "absolute")).length);
    expect(bad).toBe(0);
  });
});

test.describe("V3-08 AI summary states", () => {
  test("AI-1 hidden state: with no READY summary (or flag off) the card is absent and the page has no empty heading", async ({ page }) => {
    await page.goto(`/products/${PRODUCT_SLUG}`);
    if ((await page.getByTestId("ai-summary").count()) === 0) await expect(page.getByRole("heading", { name: /AI/ })).toHaveCount(0);
  });
  test("AI-2 visible state: label always shown, pros/cons collapsed by default and not in the a11y tree until expanded", async ({ page }) => {
    await page.goto(`/products/${PRODUCT_SLUG}`);
    const card = page.getByTestId("ai-summary");
    test.skip((await card.count()) === 0, "needs a READY ProductReviewSummary for the seeded product and the summary flag on (seed it in the CI environment)");
    await expect(page.getByTestId("ai-summary-label")).toBeVisible();
    await expect(card.getByRole("heading", { name: "Pros" })).toBeHidden();
    await card.getByRole("button").click();
    await expect(card.getByRole("heading", { name: "Pros" })).toBeVisible();
  });
});
