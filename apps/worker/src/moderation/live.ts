/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DupIndex } from "../trust/routing";
import type { HttpTransport } from "@rp/core";
import { Breaker, CATEGORIES, DailyCap, assess, createModerationProvider, systemClock, type AssessDeps, type Clock, type ModerationConfig, type ProviderCall } from "@rp/core";
import { runAssess, type AssessOutcome } from "./assess";
import { ensureCase, loadActiveConfig, prismaAssessPort, prismaStore, REASON_CODES } from "./prisma-store";
import type { BurstPort } from "../trust/routing";

/**
 * Provider call for the M6 `assess` pipeline (SEC-FIN-01). The SEC-008 defences (pinned system prompt, delimited user content, strict scores-only
 * response schema, injection hint) live inside core `assess()`, so every call goes through them. A real provider (MODERATION_PROVIDER, key from
 * MODERATION_API_KEY only) returns scores for ALL categories, which `parseProviderResponse` validates strictly; any error/timeout/garbage -> UNSURE -> human queue.
 * `createModerationProvider` refuses mock/unset in production (SEC-M6-02). Only the offline mock (dev/CI) still uses the legacy single-score mapping.
 */
export function liveProviderCall(env: { MODERATION_PROVIDER?: string; MODERATION_API_KEY?: string; MODERATION_MODEL?: string; NODE_ENV?: string }, transport?: HttpTransport): ProviderCall {
  const provider = createModerationProvider(env, transport);
  if (provider.call) return provider.call;
  return async ({ user }) => {
    const a = await provider.assess({ title: "", body: user, rating: 3 });
    return { scores: Object.fromEntries(CATEGORIES.map((c, i) => [c, i === 0 ? a.score : 0])) };
  };
}

let breaker: Breaker | undefined;
let cap: DailyCap | undefined;
/** Daily provider spend cap (calls/day); MODERATION_DAILY_CAP, default 20000. At the cap -> breaker failure code -> UNSURE -> human queue. */
const dailyCap = (clock: Clock) => (cap ??= new DailyCap(clock, Number(process.env.MODERATION_DAILY_CAP) > 0 ? Number(process.env.MODERATION_DAILY_CAP) : 20_000));
export interface LiveDeps { db: any; call: ProviderCall; clock?: Clock; burst?: BurstPort; dup?: { index: DupIndex }; sleep?: (ms: number) => Promise<void> }

/** `moderation.assess` for one queue job: ensure the M6 case, then `runAssess` (media wait, rules, provider, classify, transition). */
export async function processAssessJob(d: LiveDeps, job: { subjectType: string; subjectId: string; version: number; trigger?: string }): Promise<AssessOutcome | { status: "skipped"; reason: string }> {
  const clock = d.clock ?? systemClock;
  const caseId = await ensureCase(d.db, job, clock);
  if (!caseId) return { status: "skipped", reason: "unsupported_subject" };
  const config: ModerationConfig = await loadActiveConfig(d.db);
  breaker ??= new Breaker(clock, config.ai.circuitBreaker);
  const provider: AssessDeps = { cfg: config, call: d.call, breaker, cap: dailyCap(clock), ...(d.sleep ? { sleep: d.sleep } : {}) };
  return runAssess({ store: prismaStore(d.db, clock), port: prismaAssessPort(d.db, clock, d.burst ? { burst: d.burst, ...(d.dup ? { dup: d.dup } : {}) } : undefined), clock, config, provider, reasonCodes: REASON_CODES }, caseId, job.version);
}
export { assess };
