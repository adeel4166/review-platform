import { describe, expect, it } from "vitest";
import { FakeRateLimitRedis, clientIp, consume, loadRateLimitConfig } from "./rate-limit";

const h = (v: string | null) => ({ get: () => v });

describe("consume", () => {
  it("allows up to the limit, then returns Retry-After; window reset allows again", async () => {
    let t = 0;
    const r = new FakeRateLimitRedis(() => t);
    const rule = { limit: 2, windowSeconds: 60 };
    expect((await consume(r, "k", rule)).allowed).toBe(true);
    expect((await consume(r, "k", rule)).allowed).toBe(true);
    t = 10_000;
    expect(await consume(r, "k", rule)).toEqual({ allowed: false, retryAfterSeconds: 50 });
    t = 60_000;
    expect((await consume(r, "k", rule)).allowed).toBe(true);
  });
  it("repairs a key that lost its expiry", async () => {
    const r = new FakeRateLimitRedis();
    await r.incr("k"); await r.incr("k"); // no pexpire
    expect(await consume(r, "k", { limit: 1, windowSeconds: 60 })).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
    expect(await r.pttl("k")).toBeGreaterThan(0);
  });
});

describe("clientIp (trusted proxies)", () => {
  const cfg = (n: number) => ({ TRUSTED_PROXY_HOPS: n, CLIENT_IP_HEADER: "x-forwarded-for" });
  it("takes the entry `hops` from the right, ignoring client-forged left entries", () => {
    expect(clientIp(h("6.6.6.6, 203.0.113.9"), cfg(1))).toBe("203.0.113.9");
    expect(clientIp(h("6.6.6.6, 203.0.113.9, 10.0.0.1"), cfg(2))).toBe("203.0.113.9");
  });
  it("hops=0 trusts no header; missing header is unknown", () => {
    expect(clientIp(h("1.2.3.4"), cfg(0))).toBe("unknown");
    expect(clientIp(h(null), cfg(1))).toBe("unknown");
  });
});

describe("config", () => {
  it("has SEC-03 defaults and overrides from env", () => {
    const c = loadRateLimitConfig({});
    expect([c.RATE_LOGIN_PER_MIN, c.RATE_LOGIN_PER_HOUR, c.RATE_REGISTER_PER_HOUR, c.RATE_UPLOAD_SLOTS_PER_HOUR]).toEqual([5, 20, 5, 20]);
    expect(loadRateLimitConfig({ RATE_LOGIN_PER_MIN: "9" }).RATE_LOGIN_PER_MIN).toBe(9);
  });
});
