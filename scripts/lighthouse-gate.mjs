#!/usr/bin/env node
// ADR-0034 D10 web-vitals gate (mobile profile): LCP <= 2.5 s, CLS <= 0.1, TBT <= 200 ms (INP is field-only: see the INP note), on
// /, /products and /products/[slug]. Needs Chrome and a running production build seeded with demo data.
// Usage: BASE_URL=http://localhost:3000 PRODUCT_SLUG=acme-noise-cancelling-headphones node scripts/lighthouse-gate.mjs
// Lighthouse is fetched on demand (`npx lighthouse`), it is deliberately not a repo dependency. Writes lighthouse-report/*.json.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const routes = ["/", "/products", `/products/${process.env.PRODUCT_SLUG ?? "acme-noise-cancelling-headphones"}`];
const limits = { "largest-contentful-paint": 2500, "cumulative-layout-shift": 0.1, "total-blocking-time": 200 };
mkdirSync("lighthouse-report", { recursive: true });
let failed = false;
for (const [i, r] of routes.entries()) {
  const out = `lighthouse-report/route-${i}.json`;
  execFileSync("npx", ["--yes", "lighthouse", base + r, "--only-categories=performance,accessibility", "--output=json", `--output-path=${out}`,
    "--chrome-flags=--headless=new --no-sandbox", "--quiet"], { stdio: "inherit" }); // default preset = mobile emulation + simulated 4x CPU / slow 4G
  const lhr = JSON.parse(readFileSync(out, "utf8"));
  const line = [`${r}  perf=${Math.round(lhr.categories.performance.score * 100)} a11y=${Math.round(lhr.categories.accessibility.score * 100)}`];
  for (const [id, max] of Object.entries(limits)) {
    const v = lhr.audits[id].numericValue; const ok = v <= max; failed ||= !ok;
    line.push(`${ok ? "ok" : "FAIL"} ${id}=${Math.round(v * 1000) / 1000}/${max}`);
  }
  const lcp = lhr.audits["largest-contentful-paint-element"]; const net = lhr.audits["network-requests"]?.details?.items ?? [];
  const img = net.filter((n) => n.resourceType === "Image").sort((a, b) => b.transferSize - a.transferSize)[0];
  if (img) { const ok = img.transferSize <= 120 * 1024; failed ||= !ok; line.push(`${ok ? "ok" : "FAIL"} largest image ${Math.round(img.transferSize / 1024)}KB/120KB`); }
  void lcp; console.log(line.join("  "));
}
// INP: Lighthouse lab runs cannot measure it. Use the Playwright interaction timing in e2e (web-vitals) or field data (CrUX/RUM).
process.exit(failed ? 1 : 0);
