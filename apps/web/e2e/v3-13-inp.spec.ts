import { expect, test, type Page } from "@playwright/test";
import { PRODUCT_SLUG, REVIEW_PATH, newSignedInUser } from "./helpers";

/**
 * V3-13 / DEF-V3-08: INP interaction trace, budget 200 ms (ADR-0034 D10).
 * Uses the same Event Timing API that the `web-vitals` library reads (no new dependency): INP is the worst
 * interaction latency (p98 for >50 interactions, which these short traces never reach, so the max is used).
 * Lab INP under CI CPU is noisy; the budget is applied to the worst interaction per scenario.
 */
const INP_BUDGET_MS = 200;

async function startTrace(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __inp: Map<number, number> };
    w.__inp = new Map();
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { interactionId: number; duration: number }[]) {
        if (e.interactionId) w.__inp.set(e.interactionId, Math.max(w.__inp.get(e.interactionId) ?? 0, e.duration));
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  });
}
const readInp = (page: Page) => page.evaluate(() => Math.max(0, ...Array.from((window as unknown as { __inp: Map<number, number> }).__inp.values())));
const settle = (page: Page) => page.waitForTimeout(300); // let the next frame paint so event-timing entries flush

async function assertInp(page: Page, label: string) {
  await settle(page);
  const inp = await readInp(page);
  test.info().annotations.push({ type: "inp", description: `${label}: ${inp} ms` });
  expect(inp, `${label} INP ${inp} ms vs budget ${INP_BUDGET_MS} ms`).toBeLessThanOrEqual(INP_BUDGET_MS);
}

test.describe("V3-13 INP (budget 200 ms)", () => {
  test("INP-1 product page: tab, expand, scroll-row and keyboard interactions", async ({ page }) => {
    await page.goto(`/products/${PRODUCT_SLUG}`);
    await page.waitForLoadState("networkidle");
    await startTrace(page);
    const summary = page.getByTestId("ai-summary");
    if (await summary.count()) await summary.getByRole("button").click();
    for (const b of (await page.getByRole("button").all()).slice(0, 6)) { if (await b.isVisible() && await b.isEnabled()) await b.click({ trial: false }).catch(() => undefined); }
    await page.keyboard.press("End");
    await assertInp(page, "product page");
  });

  test("INP-2 command palette: open, type, arrow, close", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await startTrace(page);
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.type("a", { delay: 60 });
    await page.keyboard.type("bc", { delay: 60 });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await assertInp(page, "palette");
  });

  test("INP-3 review form: rating, typing in title/body", async ({ browser, baseURL }) => {
    const { context } = await newSignedInUser(browser, baseURL);
    const page = await context.newPage();
    await page.goto(REVIEW_PATH);
    await expect(page.getByLabel("Title")).toBeVisible();
    await startTrace(page);
    await page.getByRole("radio", { name: "4 stars" }).check({ force: true }).catch(() => page.getByRole("radio", { name: "4 stars" }).focus());
    await page.getByLabel("Title").click();
    await page.keyboard.type("Fast typing stays responsive", { delay: 20 });
    await page.locator("#body").click();
    await page.keyboard.type("Long body text typed one key at a time to exercise controlled-input re-renders. ".repeat(2), { delay: 10 });
    await assertInp(page, "review form");
    await context.close();
  });
});
