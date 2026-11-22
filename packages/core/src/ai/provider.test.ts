import { describe, expect, it } from "vitest";
import { FakeClock } from "../testing/fake-clock";
import { assess } from "../moderation/assess";
import { CATEGORIES } from "../moderation/config";
import { baseConfig } from "../moderation/test-config";
import { Breaker, DailyCap } from "./breaker";
import { ProviderError, callWithRetries, parseProviderResponse } from "./provider";

const cfg = baseConfig();
const ok = { scores: Object.fromEntries(CATEGORIES.map((c) => [c, 0.005])) };
const input = { contentType: "REVIEW" as const, trustBand: "MEDIUM" as const, body: "x" };

describe("AI provider contract and failure handling", () => {
  it("AIF-001 timeout: 3 attempts, two back-offs (5 s, 20 s), then UNSURE timeout", async () => {
    const waits: number[] = []; let calls = 0;
    const r = await assess({ cfg, sleep: async (ms) => void waits.push(ms), call: async () => { calls++; throw new ProviderError("timeout"); } }, input);
    expect(calls).toBe(3);
    expect(waits).toEqual([5000, 20000]);
    expect(r.classification).toMatchObject({ verdict: "UNSURE", reasonCode: "AI_UNAVAILABLE", failureCode: "timeout" });
  });
  it("AIF-002 5xx / network retried; 429 honours Retry-After", async () => {
    for (const code of ["http_5xx", "network"] as const) {
      let calls = 0;
      const r = await assess({ cfg, call: async () => { calls++; throw new ProviderError(code); } }, input);
      expect([calls, r.classification.failureCode]).toEqual([3, code]);
    }
    const waits: number[] = [];
    await callWithRetries(async () => { throw new ProviderError("http_429", 60000); }, { system: "", user: "", timeoutMs: 1 }, { maxAttempts: 3, backoffMs: [5000, 20000], sleep: async (m) => void waits.push(m) });
    expect(waits).toEqual([60000, 60000]);
  });
  it("AIF-002 recovers when a later attempt succeeds", async () => {
    let n = 0;
    const r = await assess({ cfg, call: async () => { if (++n < 3) throw new ProviderError("http_5xx"); return ok; } }, input);
    expect(r.classification.verdict).toBe("CLEAN");
  });
  it("AIF-003 schema problems are not retried", async () => {
    for (const bad of [{ scores: { spam: 0.1 } }, { scores: { ...ok.scores, spam: 1.2 } }, { ...ok, extra: 1 }, "not json", null]) {
      let calls = 0;
      const r = await assess({ cfg, call: async () => { calls++; return bad; } }, input);
      expect([calls, r.classification.failureCode]).toEqual([1, "schema"]);
    }
  });
  it("AIF-004 unsupported language: no retry, UNSUPPORTED_LANGUAGE", async () => {
    let calls = 0;
    const r = await assess({ cfg, call: async () => { calls++; return { ...ok, supportedLanguage: false }; } }, input);
    expect(calls).toBe(1);
    expect(r.classification).toMatchObject({ verdict: "UNSURE", reasonCode: "UNSUPPORTED_LANGUAGE" });
    expect(parseProviderResponse({ ...ok, supportedLanguage: false })).toMatchObject({ ok: false, failureCode: "unsupported_language" });
  });
  it("AIF-005 breaker opens at >= 50% of the last 20 calls and half-opens after 60 s; daily cap skips calls", async () => {
    const clock = new FakeClock();
    const breaker = new Breaker(clock, cfg.ai.circuitBreaker);
    for (let i = 0; i < 10; i++) breaker.record(true);
    for (let i = 0; i < 10; i++) breaker.record(false);
    expect(breaker.isOpen()).toBe(true);
    let calls = 0;
    const r = await assess({ cfg, breaker, call: async () => { calls++; return ok; } }, input);
    expect(calls).toBe(0);
    expect(r.classification).toMatchObject({ verdict: "UNSURE", failureCode: "breaker" });
    clock.advance(60_000);
    expect(breaker.allow()).toBe(true);
    breaker.record(true);
    expect(breaker.isOpen()).toBe(false);
    const cap = new DailyCap(clock, 1);
    await assess({ cfg, cap, call: async () => ok }, input);
    expect((await assess({ cfg, cap, call: async () => ok }, input)).classification.failureCode).toBe("breaker");
  });
  it("AIF-009 provider rate limit configuration is 50 / s", () => expect(cfg.ai.rateLimit).toEqual({ max: 50, durationMs: 1000 }));
});
