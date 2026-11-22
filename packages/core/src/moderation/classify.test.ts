import { describe, expect, it } from "vitest";
import { classify, type ClassifyInput, type ScoreMap } from "./classify";
import { CATEGORIES } from "./config";
import { baseConfig } from "./test-config";

const cfg = baseConfig();
const scores = (over: Partial<Record<(typeof CATEGORIES)[number], number>> = {}, base = 0.005): ScoreMap => ({ ...Object.fromEntries(CATEGORIES.map((c) => [c, base])), ...over }) as ScoreMap;
const base: ClassifyInput = { contentType: "REVIEW", trustBand: "MEDIUM" };
const run = (i: Partial<ClassifyInput>, s: ScoreMap | { fail: any }, hits: any[] = []) => // eslint-disable-line @typescript-eslint/no-explicit-any
  classify({ ...base, ...i }, "fail" in s ? { ok: false, failureCode: s.fail } : { ok: true, scores: s }, cfg, hits);

describe("classify truth table", () => {
  it("CLS-001 all below clean -> CLEAN; equal to clean is not clean", () => {
    expect(run({}, scores()).verdict).toBe("CLEAN");
    expect(run({}, scores({ spam: 0.25 })).verdict).toBe("UNSURE");
  });
  it("CLS-002 score >= violation -> VIOLATION", () => {
    const r = run({}, scores({ harassment_hate: 0.85 }));
    expect(r).toMatchObject({ verdict: "VIOLATION", source: "AI", topCategory: "harassment_hate" });
  });
  it("CLS-003 between thresholds -> UNSURE", () => expect(run({}, scores({ spam: 0.5 })).verdict).toBe("UNSURE"));
  it("CLS-004 violation wins over force-unsure", () => expect(run({ unsupportedLanguage: true }, scores({ spam: 0.95 })).verdict).toBe("VIOLATION"));
  it("CLS-005 rule hit -> VIOLATION (RULE) without scores", () => expect(run({}, { fail: "timeout" }, [{ id: "blocklist:x", violation: true }])).toMatchObject({ verdict: "VIOLATION", source: "RULE", reasonCode: "blocklist:x" }));
  it("CLS-006 violation null never violates", () => expect(run({}, scores({ fake_or_misleading: 1 })).verdict).toBe("UNSURE"));
  it("CLS-007 unsupported language -> UNSURE", () => expect(run({ unsupportedLanguage: true }, scores())).toMatchObject({ verdict: "UNSURE", reasonCode: "UNSUPPORTED_LANGUAGE" }));
  it("CLS-008 NEW band with any category > 0.10 -> UNSURE", () => {
    expect(run({ trustBand: "NEW" }, scores({ spam: 0.11 })).verdict).toBe("UNSURE");
    expect(run({ trustBand: "NEW" }, scores()).verdict).toBe("CLEAN");
  });
  it("CLS-009 external link in REVIEW -> UNSURE", () => expect(run({ hasExternalLink: true }, scores()).verdict).toBe("UNSURE"));
  it("CLS-010 extreme rating and product velocity > 20/h -> UNSURE", () => {
    expect(run({ rating: 5, productReviewsLastHour: 21 }, scores()).verdict).toBe("UNSURE");
    expect(run({ rating: 5, productReviewsLastHour: 20 }, scores()).verdict).toBe("CLEAN");
    expect(run({ rating: 3, productReviewsLastHour: 99 }, scores()).verdict).toBe("CLEAN");
  });
  it("CLS-011 threshold lookup: contentTypes -> categories -> defaults", () => {
    expect(run({ contentType: "MEDIA" }, scores({ sexual: 0.8 })).verdict).toBe("VIOLATION"); // MEDIA override 0.8
    expect(run({ contentType: "REVIEW" }, scores({ sexual: 0.8 })).verdict).toBe("UNSURE"); // categories 0.85
    expect(run({ contentType: "REVIEW" }, scores({ off_topic: 0.97 })).verdict).toBe("UNSURE"); // REVIEW override: violation null
  });
  it("CLS-012 zero tolerance flagged", () => expect(run({}, scores({ sexual_minors: 0.3 }))).toMatchObject({ verdict: "VIOLATION", zeroTolerance: true }));
  it("CLS-013 schema-invalid scores -> UNSURE schema", () => {
    expect(run({}, { ...scores(), spam: 2 } as ScoreMap)).toMatchObject({ verdict: "UNSURE", failureCode: "schema" });
    expect(run({}, { spam: 0 } as unknown as ScoreMap)).toMatchObject({ verdict: "UNSURE", failureCode: "schema" });
    expect(run({}, scores({ spam: NaN }))).toMatchObject({ verdict: "UNSURE" });
  });
  it("provider failure -> UNSURE AI_UNAVAILABLE with failureCode; malware media forces UNSURE", () => {
    expect(run({}, { fail: "http_5xx" })).toMatchObject({ verdict: "UNSURE", reasonCode: "AI_UNAVAILABLE", failureCode: "http_5xx" });
    expect(run({ malwareMedia: true }, scores()).verdict).toBe("UNSURE");
    expect(run({ resubmitAfterHuman: true }, scores()).verdict).toBe("UNSURE");
    expect(run({ mediaTimeout: true }, scores()).verdict).toBe("UNSURE");
  });
  it("CFG-002 second clause: a config that bypassed validation cannot disable the floors", () => {
    const raw = structuredClone(cfg);
    (raw.forceUnsure as any).unsupportedLanguage = false; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(classify({ ...base, unsupportedLanguage: true }, { ok: true, scores: scores() }, raw).verdict).toBe("UNSURE");
    (raw.strikes as any).zeroTolerance = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(classify(base, { ok: true, scores: scores({ sexual_minors: 0.3 }) }, raw)).toMatchObject({ verdict: "VIOLATION", zeroTolerance: true });
  });
});
