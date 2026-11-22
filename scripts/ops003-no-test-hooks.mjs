#!/usr/bin/env node
// OPS-003: production build output must contain no test-only hooks. CI runs it after `next build` and the worker build.
// Usage: node scripts/ops003-no-test-hooks.mjs [dir ...]   (default: apps/web/.next apps/worker/dist; a missing dir fails)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SENTINELS = ["__RP_TEST_ONLY__", "@rp/core/testing", "core/src/testing/", "__RP_TEST_CLOCK__", "x-test-now"];
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ["apps/web/.next", "apps/worker/dist"];
const SKIP = new Set(["cache", "node_modules"]);
let bad = 0, scanned = 0;

function walk(d) {
  for (const name of readdirSync(d)) {
    if (SKIP.has(name)) continue;
    const p = join(d, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (st.size < 20 * 1024 * 1024 && /\.(m?js|cjs|json|map|html|txt)$/.test(name)) {
      scanned++;
      const text = readFileSync(p, "utf8");
      for (const s of SENTINELS) if (text.includes(s)) { console.error(`ops003: "${s}" found in ${p}`); bad++; }
    }
  }
}
for (const d of dirs) {
  try { statSync(d); } catch { console.error(`ops003: build output ${d} not found (run the build first)`); process.exit(2); }
  walk(d);
}
if (bad) { console.error(`ops003: ${bad} test hook reference(s) in the production build`); process.exit(1); }
console.log(`ops003: ok (${scanned} files, ${dirs.join(", ")})`);
