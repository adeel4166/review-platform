#!/usr/bin/env node
// LIVE-05 staging smoke. Usage: DEMO_PASSWORD=<env> node scripts/staging-smoke.mjs [baseUrl]
// Covers: home, product page, login page, user login, admin login (+ admin API), and a review submission that reaches the moderation queue.
// Plain fetch, no dependencies. Passwords come from env only and are never printed; output is one `SMOKE ...` line per check.
import { randomBytes } from "node:crypto";
import { URLSearchParams } from "node:url";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const base = (process.argv[2] || process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const password = process.env.DEMO_PASSWORD;
if (!password) { console.error("SMOKE FAILED: DEMO_PASSWORD is not set in the environment"); process.exit(1); }
const USER = process.env.SMOKE_USER_EMAIL || "demo.user@demo.example";
const ADMIN = process.env.SMOKE_ADMIN_EMAIL || "demo.admin@demo.example";
const failures = [];
const ok = (name, detail = "") => console.log(`SMOKE OK ${name}${detail ? ` (${detail})` : ""}`);
const bad = (name, detail) => { failures.push(`${name}: ${detail}`); console.error(`SMOKE FAIL ${name}: ${detail}`); };

/** Minimal cookie jar so one actor's session carries across requests. */
function client() {
  const jar = new Map();
  const send = async (path, init = {}) => {
    const headers = { ...(init.headers || {}), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
    const res = await fetch(base + path, { ...init, headers, redirect: "manual" });
    for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1)); }
    return res;
  };
  return { send };
}

async function signIn(email) {
  const c = client();
  const { csrfToken } = await (await c.send("/api/auth/csrf")).json();
  const res = await c.send("/api/auth/callback/credentials", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, email, password, json: "true" }),
  });
  if (res.status >= 400) throw new Error(`sign-in HTTP ${res.status}`);
  const session = await (await c.send("/api/auth/session")).json();
  if (!session?.user?.id) throw new Error("no session after sign-in");
  return { c, session };
}

async function step(name, fn) { try { const d = await fn(); ok(name, d); return true; } catch (e) { bad(name, e.message); return false; } }

// 1-3: public pages render
let slugs = [];
let products = []; // {id, slug} from the public API (review POST takes the product id)
await step("home", async () => { const r = await fetch(base + "/"); if (r.status !== 200) throw new Error(`HTTP ${r.status}`); return "HTTP 200"; });
await step("product-list", async () => {
  const r = await fetch(base + "/products"); const html = await r.text();
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const api = await fetch(base + "/api/products?pageSize=20");
  if (api.status !== 200) throw new Error(`/api/products HTTP ${api.status}`);
  products = ((await api.json()).items ?? []).filter((p) => p.id && p.slug);
  slugs = products.map((p) => p.slug);
  if (!slugs.length) throw new Error("no products (is the demo seed loaded?)");
  return `${slugs.length} products listed, HTML ${html.length > 0 ? "rendered" : "empty"}`;
});
await step("product-page", async () => { const r = await fetch(`${base}/products/${slugs[0]}`); if (r.status !== 200) throw new Error(`/products/${slugs[0]} HTTP ${r.status}`); return `/products/${slugs[0]} HTTP 200`; });
await step("login-page", async () => { const r = await fetch(base + "/login"); if (r.status !== 200) throw new Error(`HTTP ${r.status}`); return "HTTP 200"; });

// 4: static assets of the pages above (reuses the CSS/JS 200 check)
await step("static-assets", async () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("./preview-smoke.mjs", import.meta.url)), base, "/", "/products", "/login", ...(slugs[0] ? [`/products/${slugs[0]}`] : [])], { encoding: "utf8" });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").slice(0, 3).join(" | "));
  return r.stdout.trim().replace(/^SMOKE OK:\s*/, "");
});

// 5: admin login + admin API
let admin;
await step("admin-login", async () => {
  admin = await signIn(ADMIN);
  const role = admin.session.user.role;
  if (!/admin/i.test(String(role))) throw new Error(`session role is ${role}`);
  const q = await admin.c.send("/api/admin/moderation?state=NEEDS_HUMAN&pageSize=1");
  if (q.status !== 200) throw new Error(`admin moderation API HTTP ${q.status}`);
  return `role ${role}, moderation API HTTP 200`;
});

// 6: user login + review submission reaches the moderation queue
await step("review-to-moderation-queue", async () => {
  const user = await signIn(USER);
  const title = `Staging smoke ${randomBytes(4).toString("hex")}`;
  const body = "Smoke test review from the staging gate: sturdy build, clear manual and quick delivery.";
  let created = null;
  for (const { id, slug } of products.slice(0, 15)) {
    const r = await user.c.send(`/api/products/${id}/reviews`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating: 4, title, body }) });
    if (r.status === 201) { created = { slug, id: (await r.json()).id }; break; }
    if (r.status !== 409 && r.status !== 422) throw new Error(`POST review HTTP ${r.status}`); // 409/422: demo user already reviewed this product, try the next
  }
  if (!created) throw new Error("no product accepted a new review from the demo user");
  if (!admin) throw new Error("admin session unavailable");
  const states = ["PENDING", "AI_REVIEW", "NEEDS_HUMAN", "APPROVED", "REJECTED"];
  for (let i = 0; i < 40; i++) { // ~2 min: the case exists from submission; the worker advances it
    for (const state of states) {
      const r = await admin.c.send(`/api/admin/moderation?state=${state}&pageSize=50`);
      if (r.status !== 200) continue;
      const { items } = await r.json();
      if (items.some((it) => it.review?.title === title)) return `review ${created.id} on /products/${created.slug} -> moderation case state ${state}`;
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error(`no moderation case for the new review (id ${created.id}) within 120 s`);
});

if (failures.length) { console.error(`SMOKE FAILED (${failures.length}):\n  ${failures.join("\n  ")}`); process.exit(1); }
console.log(`SMOKE PASSED: home, product page, login, admin login, review -> moderation queue (${base})`);
