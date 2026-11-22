/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { ConfigFloorViolation, HARD_FLOORS, validateModerationConfig } from "./config";
import { baseConfigRaw } from "./test-config";

const mut = (f: (c: any) => void) => { const c = baseConfigRaw() as any; f(c); return c; };

describe("moderation config (CFG-001, CFG-002, CFG-005)", () => {
  it("accepts the example config", () => expect(validateModerationConfig(baseConfigRaw()).version).toBeTruthy());
  it.each([
    ["holdDays 0", (c: any) => (c.timers.holdDays = 0)], ["holdDays 31", (c: any) => (c.timers.holdDays = 31)],
    ["postReviewSlaHours 0", (c: any) => (c.timers.postReviewSlaHours = 0)], ["postReviewSlaHours 169", (c: any) => (c.timers.postReviewSlaHours = 169)],
    ["appealWindowDays 13", (c: any) => (c.timers.appealWindowDays = 13)], ["appealWindowDays 91", (c: any) => (c.timers.appealWindowDays = 91)],
    ["sampleRate 1.5", (c: any) => (c.postReview.sampleRate.NEW = 1.5)],
  ])("CFG-001 rejects %s", (_n, f) => expect(() => validateModerationConfig(mut(f))).toThrow());
  it("CFG-005 requires all 13 categories and clean < violation", () => {
    expect(() => validateModerationConfig(mut((c) => delete c.categories.spam))).toThrow();
    expect(() => validateModerationConfig(mut((c) => (c.categories.spam = { clean: 0.9, violation: 0.5 })))).toThrow();
    expect(() => validateModerationConfig(mut((c) => (c.categories.spam = { clean: 0.5, violation: 0.5 })))).toThrow();
  });
  it("CFG-002 zero tolerance cannot be removed or weakened", () => {
    expect(() => validateModerationConfig(mut((c) => (c.strikes.zeroTolerance = [])))).toThrow(ConfigFloorViolation);
    expect(() => validateModerationConfig(mut((c) => (c.categories.sexual_minors.violation = 0.9)))).toThrow(ConfigFloorViolation);
    expect(() => validateModerationConfig(mut((c) => (c.categories.sexual_minors.violation = null)))).toThrow(ConfigFloorViolation);
  });
  it("CFG-002 force-unsure floors cannot be switched off", () => {
    for (const k of Object.keys(HARD_FLOORS.forceUnsure)) expect(() => validateModerationConfig(mut((c) => (c.forceUnsure[k] = false)))).toThrow(ConfigFloorViolation);
  });
});
