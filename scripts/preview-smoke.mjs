#!/usr/bin/env node
// Post-deploy smoke check: fetch each page, extract every /_next/static asset URL (CSS, JS, preloads) and assert HTTP 200.
// Usage: node scripts/preview-smoke.mjs [baseUrl] [path...]   (default http://127.0.0.1:${PREVIEW_PORT:-5101}, paths / /products /login)
// Exits 1 loudly on any non-200, non-CSS/JS content type for CSS, or if a page lists no stylesheet at all.
const base = (process.argv[2] || `http://127.0.0.1:${process.env.PREVIEW_PORT || 5101}`).replace(/\/$/, "");
const paths = process.argv.length > 3 ? process.argv.slice(3) : ["/", "/products", "/login"];
const failures = [];
let checked = 0;

for (const p of paths) {
  let res;
  try {
    res = await fetch(base + p, { redirect: "follow" });
  } catch (e) {
    failures.push(`${p}: fetch failed (${e.message})`);
    continue;
  }
  if (res.status !== 200) failures.push(`${p}: page returned HTTP ${res.status}`);
  const html = await res.text();
  const urls = new Set();
  for (const m of html.matchAll(/(?:href|src)=["']([^"']*\/_next\/static\/[^"']+)["']/g)) urls.add(m[1].replace(/&amp;/g, "&"));
  // Next also inlines chunk paths in flight data; pick up escaped ones too.
  for (const m of html.matchAll(/\/_next\/static\/[A-Za-z0-9_\-./%]+\.(?:css|js)/g)) urls.add(m[0]);
  const list = [...urls];
  if (!list.some((u) => /\.css(\?|$)/.test(u))) failures.push(`${p}: no CSS stylesheet referenced in HTML`);
  for (const u of list) {
    const abs = new URL(u, base + "/").toString();
    const r = await fetch(abs).catch((e) => ({ status: `ERR ${e.message}`, headers: new Headers() }));
    checked++;
    if (r.status !== 200) failures.push(`${p}: ${r.status} ${u}`);
    else if (/\.css(\?|$)/.test(u) && !(r.headers.get("content-type") || "").includes("css")) failures.push(`${p}: bad content-type for ${u}`);
    if (r.body?.cancel) await r.body.cancel();
  }
}

if (failures.length) {
  console.error(`SMOKE FAILED (${failures.length}):\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log(`SMOKE OK: ${paths.length} pages, ${checked} static assets all HTTP 200 (${base})`);
