import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRateLimitRedis, setRateLimitErrorHook, setRateLimitFallback } from "@rp/core";

vi.mock("@/server/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1", role: "user" })) }));
vi.mock("@/server/db", () => ({ db: { user: { create: vi.fn(async () => ({ id: "n" })) }, review: { findFirst: vi.fn(async () => null) } } }));
vi.mock("@/server/storage", () => ({ getStorage: () => ({}) }));
vi.mock("@/server/reviews", () => ({
  createReview: vi.fn(async () => ({ id: "r" })), updateOwnReview: vi.fn(async () => ({ id: "r" })),
  deleteOwnReview: vi.fn(), listPublishedReviews: vi.fn(),
}));
vi.mock("@/server/media", () => ({ createUploadSlot: vi.fn(async () => ({ assetId: "a" })), listOwnMedia: vi.fn() }));
vi.mock("@/server/auth", () => ({ handlers: { GET: vi.fn(), POST: vi.fn(async () => new Response("ok", { status: 200 })) } }));
vi.mock("@rp/db", () => ({ hashPassword: vi.fn(async () => "h"), prisma: {} }));

import { configureRateLimit } from "@/server/ratelimit";
import { POST as register } from "../app/api/auth/register/route";
import { POST as authPost } from "../app/api/auth/[...nextauth]/route";
import { POST as createReview } from "../app/api/products/[id]/reviews/route";
import { PATCH } from "../app/api/reviews/[id]/route";
import { POST as slot } from "../app/api/reviews/[id]/media/route";

const ctx = { params: Promise.resolve({ id: "ckabcdefghijklmnopqrstuvw" }) };
const mk = (url: string, method: string, body: BodyInit, headers: Record<string, string> = {}) =>
  new Request(url, { method, body, headers: { "x-forwarded-for": "203.0.113.9", ...headers } });
const loginReq = (email: string, ip = "203.0.113.9") =>
  mk("http://t/api/auth/callback/credentials", "POST", new URLSearchParams({ email, password: "x" }), { "x-forwarded-for": ip, "content-type": "application/x-www-form-urlencoded" });
const jsonReq = (method: string, body: unknown, ip?: string) => mk("http://t/api", method, JSON.stringify(body), { "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}) });

/** Sends `n` requests; returns the statuses. */
async function burst(n: number, f: () => Promise<Response>) {
  const out: Response[] = [];
  for (let i = 0; i < n; i++) out.push(await f());
  return out;
}

beforeEach(() => configureRateLimit(new FakeRateLimitRedis(), { RATE_LIMIT_ENABLED: true }));

describe("429 + Retry-After after the configured threshold", () => {
  it("login: 5/min per IP+email, other email unaffected", async () => {
    const r = await burst(6, () => authPost(loginReq("A@x.io")));
    expect(r.slice(0, 5).every((x) => x.status === 200)).toBe(true);
    expect(r[5]!.status).toBe(429);
    expect(Number(r[5]!.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await authPost(loginReq("b@x.io"))).status).toBe(200);
    expect((await authPost(loginReq("a@x.io", "198.51.100.1"))).status).toBe(200); // other IP
  });
  it("login: 20/h cap holds even when the per-minute window rolls", async () => {
    let t = 0;
    configureRateLimit(new FakeRateLimitRedis(() => t), { RATE_LIMIT_ENABLED: true });
    let ok = 0;
    for (let i = 0; i < 30; i++) {
      t += 61_000; // fresh minute every attempt
      if ((await authPost(loginReq("a@x.io"))).status === 200) ok++;
    }
    expect(ok).toBe(20);
  });
  it("register: 5/h per IP", async () => {
    const body = { email: "n@x.io", handle: "nn", displayName: "N", password: "correct horse battery" };
    const r = await burst(6, () => register(jsonReq("POST", body)));
    expect(r[5]!.status).toBe(429);
    expect(r[5]!.headers.get("Retry-After")).toBeTruthy();
    expect(r[4]!.status).not.toBe(429);
  });
  it("review create + edit share 10/h per user", async () => {
    const body = { rating: 5, title: "Great stuff", body: "x".repeat(60) };
    const r = await burst(10, () => createReview(jsonReq("POST", body, `10.0.0.${Math.random() * 200 | 0}`), ctx));
    expect(r.every((x) => x.status !== 429)).toBe(true);
    const over = await PATCH(jsonReq("PATCH", {}, "10.0.0.250"), ctx);
    expect(over.status).toBe(429);
    expect(over.headers.get("Retry-After")).toBeTruthy();
  });
  it("review writes: per-IP cap applies across users", async () => {
    configureRateLimit(new FakeRateLimitRedis(), { RATE_LIMIT_ENABLED: true, RATE_REVIEW_IP_PER_HOUR: 3, RATE_REVIEW_USER_PER_HOUR: 100, RATE_REVIEW_USER_PER_DAY: 100 });
    const r = await burst(4, () => PATCH(jsonReq("PATCH", {}), ctx));
    expect(r.map((x) => x.status === 429)).toEqual([false, false, false, true]);
  });
  it("upload slots: 20/h per user", async () => {
    const body = { mimeType: "image/png", sizeBytes: 100 };
    const r = await burst(21, () => slot(jsonReq("POST", body), ctx));
    expect(r.slice(0, 20).every((x) => x.status === 201)).toBe(true);
    expect(r[20]!.status).toBe(429);
  });
  it("limits come from config", async () => {
    configureRateLimit(new FakeRateLimitRedis(), { RATE_LIMIT_ENABLED: true, RATE_REGISTER_PER_HOUR: 1 });
    const body = { email: "n@x.io", handle: "nn", displayName: "N", password: "correct horse battery" };
    expect((await register(jsonReq("POST", body))).status).not.toBe(429);
    expect((await register(jsonReq("POST", body))).status).toBe(429);
  });
  describe("Redis down (R-1)", () => {
    const dead = { incr: async () => { throw new Error("down"); }, pexpire: async () => 0, pttl: async () => -2 };
    beforeEach(() => {
      setRateLimitFallback(undefined);
      configureRateLimit(dead, { RATE_LIMIT_ENABLED: true });
      vi.spyOn(console, "error").mockImplementation(() => undefined);
    });
    it("login fails CLOSED: 429 after the threshold, not unlimited attempts", async () => {
      const r = await burst(7, () => authPost(loginReq("a@x.io")));
      expect(r.slice(0, 5).every((x) => x.status === 200)).toBe(true);
      expect(r[5]!.status).toBe(429);
      expect(r[6]!.status).toBe(429);
      expect(r[5]!.headers.get("Retry-After")).toBeTruthy();
    });
    it("register fails CLOSED", async () => {
      const body = { email: "n@x.io", handle: "nn", displayName: "N", password: "correct horse battery" };
      const r = await burst(6, () => register(jsonReq("POST", body)));
      expect(r[5]!.status).toBe(429);
    });
    it("review writes and upload slots stay fail-open", async () => {
      const r = await burst(15, () => PATCH(jsonReq("PATCH", {}), ctx));
      expect(r.every((x) => x.status !== 429)).toBe(true);
      const s = await burst(25, () => slot(jsonReq("POST", { mimeType: "image/png", sizeBytes: 100 }), ctx));
      expect(s.every((x) => x.status === 201)).toBe(true);
    });
    it("limiter errors reach the alert/metric hook", async () => {
      const hook = vi.fn();
      setRateLimitErrorHook(hook);
      try {
        await authPost(loginReq("a@x.io"));
        expect(hook).toHaveBeenCalled();
        expect(hook.mock.calls[0]![0]).toMatchObject({ mode: "closed" });
      } finally { setRateLimitErrorHook(undefined); }
    });
    it("a throwing hook cannot break the request", async () => {
      setRateLimitErrorHook(() => { throw new Error("boom"); });
      try { expect((await authPost(loginReq("a@x.io"))).status).toBe(200); } finally { setRateLimitErrorHook(undefined); }
    });
  });
});
