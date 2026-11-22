/* eslint-disable @typescript-eslint/no-explicit-any */
import { Breaker, type NearDuplicateIndex, CATEGORIES, assess, createModerationProvider, systemClock, type AssessDeps, type Clock, type ModerationConfig, type ProviderCall } from "@rp/core";
import { runAssess, type AssessOutcome } from "./assess";
import { ensureCase, loadActiveConfig, prismaAssessPort, prismaStore, REASON_CODES } from "./prisma-store";
import type { BurstPort } from "../trust/routing";

/**
 * Provider call for the M6 `assess` pipeline. The SEC-008 defences (pinned system prompt, delimited user content, strict scores-only
 * response schema, injection hint) all live inside core `assess()`, so every call here goes through them.
 * `createModerationProvider` refuses mock/unset in production (SEC-M6-02), so a misconfigured production worker throws and the
 * job dead-letters to a human instead of auto-approving.
 */
export function liveProviderCall(env: { MODERATION_PROVIDER?: string; MODERATION_API_KEY?: string; NODE_ENV?: string }): ProviderCall {
  const provider = createModerationProvider(env);
  return async ({ user }) => {
    const a = await provider.assess({ title: "", body: user, rating: 3 });
    // Legacy single-score providers are mapped onto the first category; real scores-only providers will replace this adapter.
    return { scores: Object.fromEntries(CATEGORIES.map((c, i) => [c, i === 0 ? a.score : 0])) };
  };
}

let breaker: Breaker | undefined;
export interface LiveDeps { db: any; call: ProviderCall; clock?: Clock; burst?: BurstPort; dup?: { index: NearDuplicateIndex }; sleep?: (ms: number) => Promise<void> }

/** `moderation.assess` for one queue job: ensure the M6 case, then `runAssess` (media wait, rules, provider, classify, transition). */
export async function processAssessJob(d: LiveDeps, job: { subjectType: string; subjectId: string; version: number; trigger?: string }): Promise<AssessOutcome | { status: "skipped"; reason: string }> {
  const clock = d.clock ?? systemClock;
  const caseId = await ensureCase(d.db, job, clock);
  if (!caseId) return { status: "skipped", reason: "unsupported_subject" };
  const config: ModerationConfig = await loadActiveConfig(d.db);
  breaker ??= new Breaker(clock, config.ai.circuitBreaker);
  const provider: AssessDeps = { cfg: config, call: d.call, breaker, ...(d.sleep ? { sleep: d.sleep } : {}) };
  return runAssess({ store: prismaStore(d.db, clock), port: prismaAssessPort(d.db, clock, d.burst ? { burst: d.burst, ...(d.dup ? { dup: d.dup } : {}) } : undefined), clock, config, provider, reasonCodes: REASON_CODES }, caseId, job.version);
}
export { assess };
