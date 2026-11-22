#!/usr/bin/env node
// ADR-0034 D10: first-load JS (gzip) per route vs docs/qa/bundle-budget.json, plus CSS and preloaded-font budgets.
// Usage: pnpm --filter @rp/web build && node scripts/bundle-budget.mjs [--report]   (exit 1 on overrun unless --report)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const web = join(import.meta.dirname, "..", "apps", "web", ".next");
const cfg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "docs", "qa", "bundle-budget.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(web, "app-build-manifest.json"), "utf8")).pages;
const size = new Map();
const gz = (f) => size.get(f) ?? size.set(f, gzipSync(readFileSync(join(web, f))).length).get(f);
const kb = (n) => Math.round((n / 1024) * 10) / 10;
const rows = [];
for (const [page, files] of Object.entries(manifest)) {
  const route = page.replace(/\/page$/, "") || "/";
  if (route.startsWith("/api") || route.includes("/_") || route === "/layout") continue;
  const group = cfg.groups.find((g) => g.match.some((m) => new RegExp(m).test(route)));
  if (!group) continue;
  const js = [...new Set(files.filter((f) => f.endsWith(".js")))].reduce((s, f) => s + gz(f), 0);
  rows.push({ route, group: group.name, kb: kb(js), budget: group.budget_kb, ok: kb(js) <= group.budget_kb });
}
const cssDir = join(web, "static", "css");
const css = readdirSync(cssDir).filter((f) => f.endsWith(".css")).reduce((s, f) => s + gzipSync(readFileSync(join(cssDir, f))).length, 0);
const mediaDir = join(web, "static", "media");
const fonts = readdirSync(mediaDir).filter((f) => f.endsWith(".p.woff2")).reduce((s, f) => s + statSync(join(mediaDir, f)).size, 0); // ".p." = preloaded by next/font
rows.sort((a, b) => Number(a.ok) - Number(b.ok) || a.route.localeCompare(b.route));
for (const r of rows) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.route.padEnd(36)} ${String(r.kb).padStart(7)} KB / ${r.budget} KB  [${r.group}]`);
console.log(`${kb(css) <= cfg.css_gzip_kb ? "ok  " : "FAIL"} global CSS gzip ${kb(css)} KB / ${cfg.css_gzip_kb} KB`);
console.log(`${kb(fonts) <= cfg.preloaded_fonts_kb ? "ok  " : "FAIL"} preloaded fonts ${kb(fonts)} KB / ${cfg.preloaded_fonts_kb} KB`);
const failed = rows.some((r) => !r.ok) || kb(css) > cfg.css_gzip_kb || kb(fonts) > cfg.preloaded_fonts_kb;
process.exit(failed && !process.argv.includes("--report") ? 1 : 0);
