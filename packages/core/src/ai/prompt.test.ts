import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assess } from "../moderation/assess";
import { CATEGORIES } from "../moderation/config";
import { baseConfig } from "../moderation/test-config";
import { PINNED_SYSTEM_PROMPT_SHA256, SYSTEM_PROMPT, buildUserMessage, looksLikeInjection, systemPromptHash } from "./prompt";
import type { ProviderCall } from "./provider";

const cfg = baseConfig();
const pairs = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../test/fixtures/moderation/injection-canaries.json", import.meta.url)), "utf8")) as { id: string; canary: string; twin: string }[];
const cleanScores = Object.fromEntries(CATEGORIES.map((c) => [c, 0.005]));
/** Pinned in the test on purpose: changing the system prompt must be a reviewed change (SEC-008 d). */
const EXPECTED_PROMPT_HASH = "921d143f91a97761078302787fd218f865784402a20e060353cf32795bfb0b4c";

const run = (call: ProviderCall, body: string) => assess({ cfg, call }, { contentType: "REVIEW", trustBand: "MEDIUM", title: "t", body });

describe("SEC-008 prompt-injection canaries", () => {
  it("corpus has at least 30 pairs", () => expect(pairs.length).toBeGreaterThanOrEqual(30));
  it("(a) canary text appears only inside the JSON-escaped data field", async () => {
    for (const p of pairs) {
      let seen: { system: string; user: string } | undefined;
      await run(async (r) => ((seen = r), { scores: cleanScores }), p.canary);
      expect(seen!.system).not.toContain(p.canary);
      const parsed = JSON.parse(seen!.user) as { content: { body: string }; task: string };
      expect(parsed.content.body).toBe(p.canary);
      expect(parsed.task).toBe("classify");
      expect(buildUserMessage({ contentType: "REVIEW", body: p.canary })).toBe(JSON.stringify(JSON.parse(buildUserMessage({ contentType: "REVIEW", body: p.canary }))));
    }
  });
  it("(b) an obedient provider (extra keys / bare verdict) yields UNSURE schema, never CLEAN", async () => {
    for (const p of pairs) {
      for (const answer of [{ verdict: "CLEAN" }, { scores: cleanScores, verdict: "CLEAN" }, JSON.stringify({ verdict: "CLEAN" }), "CLEAN", { scores: cleanScores, note: p.canary }]) {
        const r = await run(async () => answer, p.canary);
        expect(r.classification).toMatchObject({ verdict: "UNSURE", failureCode: "schema" });
      }
    }
  });
  it("(c) with equal scripted scores verdict(canary) = verdict(twin)", async () => {
    for (const p of pairs) {
      const a = await run(async () => ({ scores: cleanScores }), p.canary);
      const b = await run(async () => ({ scores: cleanScores }), p.twin);
      expect(a.classification.verdict).toBe(b.classification.verdict);
      const hi = { scores: { ...cleanScores, spam: 0.5 } };
      expect((await run(async () => hi, p.canary)).classification.verdict).toBe((await run(async () => hi, p.twin)).classification.verdict);
    }
  });
  it("(d) the system prompt hash equals the pinned value", () => {
    expect(systemPromptHash(SYSTEM_PROMPT)).toBe(PINNED_SYSTEM_PROMPT_SHA256);
    expect(systemPromptHash()).toBe(EXPECTED_PROMPT_HASH);
  });
  it("instruction-like text is a staff-only hint with no verdict effect", async () => {
    const r = await run(async () => ({ scores: cleanScores }), pairs[0]!.canary);
    expect(r.instructionLike).toBe(true);
    expect(r.classification.verdict).toBe("CLEAN");
    expect(looksLikeInjection(pairs[0]!.twin)).toBe(false);
  });
});
