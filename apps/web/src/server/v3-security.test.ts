import { afterEach, describe, expect, it, vi } from "vitest";

/** V3-11 regression tests for SEC-V3-01 (search rate limit) and SEC-V3-02 (next/image remotePatterns scope). */
describe("next.config remotePatterns", () => {
  afterEach(() => vi.unstubAllEnvs());
  const load = async () => { vi.resetModules(); const cfgPath = "../../next.config.mjs"; // untyped JS config
    const m = (await import(/* @vite-ignore */ cfgPath)) as { default: { images: { remotePatterns: { hostname: string; pathname?: string }[] } } };
    return m.default.images.remotePatterns; };
  it("pins Cloudinary to the configured cloud", async () => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "acme");
    const p = (await load()).find((x) => x.hostname === "res.cloudinary.com");
    expect(p?.pathname).toBe("/acme/**");
  });
  it("allows no Cloudinary host without a cloud name or with a malformed one", async () => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "");
    expect((await load()).some((x) => x.hostname === "res.cloudinary.com")).toBe(false);
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "a/../b");
    expect((await load()).some((x) => x.hostname === "res.cloudinary.com")).toBe(false);
  });
});

describe("GET /api/products rate limit", () => {
  it("calls the public-read limiter before querying", async () => {
    vi.resetModules();
    const order: string[] = [];
    vi.doMock("@/server/ratelimit", () => ({ limitPublicRead: vi.fn(async () => { order.push("limit"); }) }));
    vi.doMock("@/server/db", () => ({ db: {} }));
    vi.doMock("@/server/storage", () => ({ getImageResolver: () => ({}) }));
    vi.doMock("@/server/products", () => ({ listProducts: vi.fn(async () => { order.push("query"); return { items: [] }; }) }));
    const { GET } = await import("../app/api/products/route");
    const res = await GET(new Request("http://t/api/products?q=abc"));
    expect(res.status).toBe(200);
    expect(order).toEqual(["limit", "query"]);
  });
});
