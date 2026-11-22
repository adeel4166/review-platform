import { callWithRetries, type ProviderCall, type ProviderResult } from "../ai/provider";
import type { Breaker, DailyCap } from "../ai/breaker";
import { SYSTEM_PROMPT, buildUserMessage, looksLikeInjection } from "../ai/prompt";
import { classify, type ClassifyInput, type Classification, type ProviderOutcome, type RuleHit } from "./classify";
import type { ModerationConfig } from "./config";

export interface AssessDeps {
  call: ProviderCall; cfg: ModerationConfig; breaker?: Breaker; cap?: DailyCap;
  sleep?: (ms: number) => Promise<void>;
}
export interface AssessInput extends ClassifyInput { title?: string; body: string; ruleHits?: readonly RuleHit[] }
export interface AssessResult { classification: Classification; provider: ProviderResult | { ok: false; failureCode: "breaker"; retryable: false }; rationale?: string; instructionLike: boolean; attempts: boolean }

/**
 * Never throws and never returns CLEAN unless the provider returned a complete, in-range score map that is below every
 * clean threshold and no rule hit exists (AIF-008). Rule hits short-circuit the provider (CLS-005).
 */
export async function assess(deps: AssessDeps, input: AssessInput): Promise<AssessResult> {
  const instructionLike = looksLikeInjection(`${input.title ?? ""}\n${input.body}`);
  const hits = input.ruleHits ?? [];
  try {
    if (hits.some((h) => h.violation)) {
      return { classification: classify(input, { ok: false, failureCode: "schema" }, deps.cfg, hits), provider: { ok: false, failureCode: "schema", retryable: false }, instructionLike, attempts: false };
    }
    let provider: AssessResult["provider"];
    if (input.unsupportedLanguage) provider = { ok: false, failureCode: "unsupported_language", retryable: false };
    else if ((deps.breaker && !deps.breaker.allow()) || (deps.cap && !deps.cap.take())) provider = { ok: false, failureCode: "breaker", retryable: false };
    else {
      provider = await callWithRetries(deps.call, { system: SYSTEM_PROMPT, user: buildUserMessage({ contentType: input.contentType, title: input.title, body: input.body, rating: input.rating }), timeoutMs: deps.cfg.ai.timeoutMs },
        { maxAttempts: deps.cfg.ai.maxAttempts, backoffMs: deps.cfg.ai.backoffMs, sleep: deps.sleep ?? (async () => {}) });
      deps.breaker?.record(provider.ok || provider.failureCode === "unsupported_language");
    }
    const outcome: ProviderOutcome = provider.ok ? { ok: true, scores: provider.scores } : { ok: false, failureCode: provider.failureCode };
    const classification = classify({ ...input, unsupportedLanguage: input.unsupportedLanguage || (!provider.ok && provider.failureCode === "unsupported_language") }, outcome, deps.cfg, hits);
    return { classification, provider, rationale: provider.ok ? provider.rationale : undefined, instructionLike, attempts: true };
  } catch {
    return { classification: { verdict: "UNSURE", source: "RULE", reasonCode: "AI_UNAVAILABLE", failureCode: "network" }, provider: { ok: false, failureCode: "network", retryable: true } as never, instructionLike, attempts: true };
  }
}
