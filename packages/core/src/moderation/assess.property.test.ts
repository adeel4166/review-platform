import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assess } from "./assess";
import { CATEGORIES, thresholdFor } from "./config";
import { ProviderError } from "../ai/provider";
import { baseConfig } from "./test-config";

const cfg = baseConfig();
const scoreMap = fc.record(Object.fromEntries(CATEGORIES.map((c) => [c, fc.double({ min: -0.5, max: 1.5, noNaN: false })])) as Record<string, fc.Arbitrary<number>>);
const junk = fc.oneof(fc.constant(null), fc.constant(undefined), fc.string(), fc.integer(), fc.array(fc.anything()), fc.anything(), fc.constant("{\"verdict\":\"CLEAN\"}"));
const providerOutput = fc.oneof(
  junk,
  fc.record({ scores: scoreMap }),
  fc.record({ scores: scoreMap, verdict: fc.constant("CLEAN") }),
  fc.record({ scores: scoreMap, language: fc.string(), supportedLanguage: fc.boolean(), rationale: fc.string({ maxLength: 400 }) }),
  scoreMap.map((s) => JSON.stringify({ scores: s })),
  fc.record({ scores: fc.dictionary(fc.constantFrom(...CATEGORIES), fc.double({ min: 0, max: 1, noNaN: true })) }), // possibly missing categories
);
const failure = fc.constantFrom<ProviderError>(new ProviderError("timeout"), new ProviderError("http_5xx"), new ProviderError("http_429", 10), new ProviderError("network"));

describe("AIF-008 property: assess() returns CLEAN only for a complete, in-range, below-clean score map with no rule hit", () => {
  const check = async (out: unknown, thrown: Error | undefined, ruleHit: boolean, band: "NEW" | "MEDIUM", lang: boolean) => {
    const res = await assess({ cfg, call: async () => { if (thrown) throw thrown; return out; } }, { contentType: "REVIEW", trustBand: band, body: "b", unsupportedLanguage: lang, ruleHits: ruleHit ? [{ id: "r", violation: true }] : [] });
    if (res.classification.verdict !== "CLEAN") return;
    expect(ruleHit).toBe(false);
    expect(thrown).toBeUndefined();
    expect(lang).toBe(false);
    const o = (typeof out === "string" ? JSON.parse(out) : out) as { scores: Record<string, number>; verdict?: unknown };
    expect(o.verdict).toBeUndefined();
    for (const c of CATEGORIES) {
      expect(typeof o.scores[c]).toBe("number");
      expect(o.scores[c]).toBeGreaterThanOrEqual(0);
      expect(o.scores[c]).toBeLessThan(thresholdFor(cfg, "REVIEW", c).clean);
    }
  };
  it("holds for generated provider outputs", async () => {
    await fc.assert(fc.asyncProperty(providerOutput, fc.boolean(), fc.constantFrom("NEW", "MEDIUM") as fc.Arbitrary<"NEW" | "MEDIUM">, fc.boolean(), async (out, rule, band, lang) => check(out, undefined, rule, band, lang)), { numRuns: 400 });
  });
  it("holds for thrown errors", async () => {
    await fc.assert(fc.asyncProperty(failure, async (e) => check(undefined, e, false, "MEDIUM", false)), { numRuns: 50 });
    await fc.assert(fc.asyncProperty(fc.string(), async (m) => check(undefined, new Error(m), false, "MEDIUM", false)), { numRuns: 50 });
  });
  it("sanity: a clean map IS clean (the property is not vacuous)", async () => {
    const out = { scores: Object.fromEntries(CATEGORIES.map((c) => [c, 0.005])) };
    const r = await assess({ cfg, call: async () => out }, { contentType: "REVIEW", trustBand: "MEDIUM", body: "ok" });
    expect(r.classification.verdict).toBe("CLEAN");
  });
});
