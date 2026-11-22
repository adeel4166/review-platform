import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertDemoSeedAllowed } from "../../../packages/db/prisma/seed-demo-guard";
import { DEMO_ACCOUNTS, buildDemoData } from "../../../packages/db/prisma/seed-demo-data";

const dbDir = new URL("../../../packages/db/", import.meta.url).pathname;

describe("LIVE-01 demo seed: production guard", () => {
  it("refuses NODE_ENV=production and APP_ENV=production (any case/whitespace)", () => {
    expect(() => assertDemoSeedAllowed({ NODE_ENV: "production", DEMO_PASSWORD: "a-long-demo-password" })).toThrow(/production/);
    expect(() => assertDemoSeedAllowed({ APP_ENV: " Production ", DEMO_PASSWORD: "a-long-demo-password" })).toThrow(/production/);
  });
  it("requires DEMO_PASSWORD from env (no default, min 12 chars) and the error never echoes it", () => {
    expect(() => assertDemoSeedAllowed({})).toThrow(/DEMO_PASSWORD/);
    expect(() => assertDemoSeedAllowed({ DEMO_PASSWORD: "short" })).toThrow(/DEMO_PASSWORD/);
    expect(() => assertDemoSeedAllowed({ DEMO_PASSWORD: "short" })).not.toThrow(/"short"|: short/);
    expect(assertDemoSeedAllowed({ NODE_ENV: "development", APP_ENV: "staging", DEMO_PASSWORD: "a-long-demo-password" })).toBe("a-long-demo-password");
  });
  it.each([["NODE_ENV"], ["APP_ENV"]])("the script itself exits 1 with %s=production before touching a database", (k) => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "prisma/seed-demo.ts"], {
      cwd: dbDir, encoding: "utf8", timeout: 30_000,
      env: { PATH: process.env.PATH, [k]: "production", DEMO_PASSWORD: "a-long-demo-password", DATABASE_URL: "mysql://u:p@127.0.0.1:1/none" },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("REFUSED");
    expect(r.stdout + r.stderr).not.toContain("a-long-demo-password");
  }, 40_000);
  it("the script exits 1 when DEMO_PASSWORD is unset (nothing hardcoded)", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "prisma/seed-demo.ts"], { cwd: dbDir, encoding: "utf8", timeout: 30_000, env: { PATH: process.env.PATH, DATABASE_URL: "mysql://u:p@127.0.0.1:1/none" } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("DEMO_PASSWORD");
  }, 40_000);
});

describe("LIVE-01 demo seed: dataset", () => {
  const d = buildDemoData();
  it("V3-04: every product has a primary image plus a gallery, with required alt text (placeholder, no network)", () => {
    for (const p of d.products) {
      const imgs = d.productImages.filter((i) => i.productId === p.id);
      expect(imgs.length).toBeGreaterThanOrEqual(1);
      expect(imgs.filter((i) => i.isPrimary)).toHaveLength(1);
      expect(imgs.map((i) => i.position).sort()).toEqual(imgs.map((_, k) => k));
      for (const i of imgs) {
        expect(i.alt.trim().length).toBeGreaterThan(0);
        expect(i.publicId.startsWith("placeholder/")).toBe(true);
        expect(existsSync(new URL(`../../web/public/placeholders/${i.publicId.slice("placeholder/".length)}.${i.format}`, import.meta.url))).toBe(true);
      }
    }
    expect(new Set(d.productImages.map((i) => i.id)).size).toBe(d.productImages.length);
  });
  it("is deterministic (idempotent upserts by id)", () => expect(JSON.stringify(buildDemoData())).toBe(JSON.stringify(d)));
  it("8 categories, 40 products, ~200 reviews, 6 sellers (some verified)", () => {
    expect(d.categories).toHaveLength(8);
    expect(d.products).toHaveLength(40);
    expect(d.reviews).toHaveLength(200);
    expect(d.sellers).toHaveLength(6);
    expect(d.sellers.some((s) => s.verified)).toBe(true);
    expect(d.sellers.some((s) => !s.verified)).toBe(true);
    expect(d.products.every((p) => p.specs.imageUrl && p.description && Object.keys(p.specs).length >= 5)).toBe(true);
  });
  it("ids and unique keys do not collide (product+author unique, slugs, handles, emails)", () => {
    const uniq = (a: string[]) => expect(new Set(a).size).toBe(a.length);
    uniq(d.reviews.map((r) => `${r.productId}:${r.authorId}`));
    uniq(d.reviews.map((r) => r.id)); uniq(d.products.map((p) => p.slug)); uniq(d.products.map((p) => p.gtin));
    uniq(d.users.map((u) => u.handle)); uniq(d.users.map((u) => u.email)); uniq(d.users.map((u) => u.id));
    uniq(d.votes.map((v) => `${v.reviewId}:${v.userId}`)); uniq(d.replies.map((r) => r.reviewId));
    for (const u of d.users) expect(u.handle.length).toBeLessThanOrEqual(32);
  });
  it("ratings span 1..5 with a realistic skew; some reviews are verified buyers; votes and seller replies exist", () => {
    const pub = d.reviews.filter((r) => r.status === "PUBLISHED");
    for (const star of [1, 2, 3, 4, 5]) expect(pub.filter((r) => r.rating === star).length, `${star} stars`).toBeGreaterThan(3);
    expect(pub.filter((r) => r.rating >= 4).length).toBeGreaterThan(pub.length / 2);
    expect(pub.filter((r) => r.verified).length).toBeGreaterThan(30);
    expect(d.reviews.filter((r) => r.status !== "PUBLISHED").every((r) => !r.verified)).toBe(true);
    expect(d.votes.length).toBeGreaterThan(100);
    expect(d.replies.length).toBeGreaterThanOrEqual(20);
    const prod = new Map(d.products.map((p) => [p.id, p]));
    const rev = new Map(d.reviews.map((r) => [r.id, r]));
    for (const rp of d.replies) { expect(rev.get(rp.reviewId)!.status).toBe("PUBLISHED"); expect(prod.get(rev.get(rp.reviewId)!.productId)!.sellerId).toBe(rp.sellerId); expect(rp.body.length).toBeLessThanOrEqual(1500); }
  });
  it("products in one category share numeric spec keys (comparison-ready), with >= 2 comparable numbers", () => {
    for (const cat of d.categories) {
      const ps = d.products.filter((p) => p.categorySlug === cat.slug);
      expect(ps).toHaveLength(5);
      const keys = (p: (typeof ps)[number]) => Object.keys(p.specs).filter((k) => typeof p.specs[k] === "number").sort().join(",");
      expect(new Set(ps.map(keys)).size).toBe(1);
      expect(keys(ps[0]!).split(",").length).toBeGreaterThanOrEqual(2);
    }
  });
  it("has follows, held / post-review / reported cases, and appeals against resolved cases", () => {
    expect(d.follows.length).toBeGreaterThan(10);
    expect(new Set(d.cases.map((c) => c.lane))).toEqual(new Set(["HOLD", "POST_REVIEW", "REPORTED"]));
    expect(d.cases.filter((c) => !c.resolved).length).toBeGreaterThanOrEqual(3);
    expect(d.appeals.length).toBeGreaterThanOrEqual(2);
    for (const a of d.appeals) expect(d.cases.find((c) => c.id === a.caseId)!.resolved).toBe(true);
  });
  it("one demo account per role, no password or secret in the dataset", () => {
    const roles = Object.fromEntries(d.users.filter((u) => u.login).map((u) => [u.email, u.role ?? (u.sellerOwnerOf ? "SELLER" : "USER")]));
    expect(roles).toEqual({ [DEMO_ACCOUNTS.user]: "USER", [DEMO_ACCOUNTS.seller]: "SELLER", [DEMO_ACCOUNTS.moderator]: "MODERATOR", [DEMO_ACCOUNTS.seniorModerator]: "SENIOR_MODERATOR", [DEMO_ACCOUNTS.admin]: "ADMIN", [DEMO_ACCOUNTS.superAdmin]: "SUPER_ADMIN" });
    expect(JSON.stringify(d)).not.toMatch(/password|secret/i);
    expect(d.users.every((u) => u.email.endsWith("@demo.example"))).toBe(true);
  });
});
