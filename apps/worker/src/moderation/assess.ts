import { assess, transition, type AssessDeps, type Clock, type FailureCode, type ModerationConfig, type RuleHit, type Store, type Target, type TrustBand, type ClassifyInput } from "@rp/core";
import type { ProviderResult } from "@rp/core";

/** Port over the persistence the assess job needs (Prisma adapter in prisma-ports.ts; MemoryStore-backed in tests). */
export interface AssessPort {
  load(caseId: string): Promise<AssessSubject | null>;
}
export interface AssessSubject {
  caseId: string; target: Target; caseVersion: number; targetVersion: number; targetStatus: string; kind: "CONTENT" | "REVISION";
  caseCreatedAt: Date; caseResolved: boolean; lane: "HOLD" | "POST_REVIEW" | "REPORTED" | null;
  content: { title?: string; body: string; rating?: number | null };
  trustBand: TrustBand; contentType: ClassifyInput["contentType"];
  media: "NONE" | "PENDING" | "READY" | "MALWARE";
  hasExternalLink: boolean; productReviewsLastHour: number; resubmitAfterHuman: boolean; unsupportedLanguage: boolean;
  ruleHits: readonly RuleHit[]; /** M7: NEAR_DUPLICATE / PRODUCT_BURST from trust routing. */ extraForceUnsure?: readonly string[]; rescanCount: number; priorDecisionsAllAiUnavailable: boolean; hasHumanDecision: boolean;
}
export interface AssessJobDeps { store: Store; port: AssessPort; clock: Clock; config: ModerationConfig; provider: AssessDeps; reasonCodes: ReadonlySet<string>; alert?: (kind: string, d: Record<string, unknown>) => void }
export type AssessOutcome =
  | { status: "delay"; delayMs: number }            // media still processing: processor throws DelayedError (30 s, <= maxWaitMinutes)
  | { status: "skipped"; reason: string }
  | { status: "applied"; verdict: "CLEAN" | "VIOLATION" | "UNSURE"; transition: string }
  | { status: "unchanged"; verdict: "UNSURE" };      // re-scan UNSURE changes nothing

export const MEDIA_POLL_MS = 30_000;

/** `moderation.assess` (job-catalogue §3): media wait, rules, provider, classify, transition(ASSESS_*). Idempotent. */
export async function runAssess(deps: AssessJobDeps, caseId: string, expectedVersion: number): Promise<AssessOutcome> {
  const s = await deps.port.load(caseId);
  if (!s || s.caseResolved) return { status: "skipped", reason: "already_resolved" };
  if (s.caseVersion !== expectedVersion || s.targetVersion !== expectedVersion) return { status: "skipped", reason: "version_superseded" }; // discard superseded results
  if (!["PENDING", "HELD", "HIDDEN"].includes(s.targetStatus)) return { status: "skipped", reason: "already_decided" }; // redelivery after the decision
  const now = deps.clock.now();
  const waitedMs = now.getTime() - s.caseCreatedAt.getTime();
  let mediaTimeout = false;
  if (s.media === "PENDING") {
    if (waitedMs < deps.config.media.maxWaitMinutes * 60_000) return { status: "delay", delayMs: MEDIA_POLL_MS };
    mediaTimeout = true; // MEDIA_TIMEOUT -> UNSURE (QA-M5-04, MED-030)
  }
  const started = now.getTime(); // latency from the injected clock
  const res = await assess(deps.provider, {
    contentType: s.contentType, trustBand: s.trustBand, title: s.content.title, body: s.content.body, rating: s.content.rating ?? null,
    hasExternalLink: s.hasExternalLink, productReviewsLastHour: s.productReviewsLastHour, unsupportedLanguage: s.unsupportedLanguage,
    mediaTimeout, malwareMedia: s.media === "MALWARE", extraForceUnsure: s.extraForceUnsure, resubmitAfterHuman: s.resubmitAfterHuman, ruleHits: s.ruleHits,
  });
  const c = res.classification;
  if (s.targetStatus === "HIDDEN" || s.targetStatus === "HELD") { // re-scan of a held item (T4r / T4v): UNSURE changes nothing
    if (c.verdict === "UNSURE") return { status: "unchanged", verdict: "UNSURE" };
    if (c.verdict === "CLEAN" && (s.hasHumanDecision || !s.priorDecisionsAllAiUnavailable)) return { status: "skipped", reason: "not_rescannable" };
  }
  const event = c.verdict === "CLEAN" ? "ASSESS_CLEAN" : c.verdict === "VIOLATION" ? "ASSESS_VIOLATION" : "ASSESS_UNSURE";
  const failure: FailureCode | undefined = c.failureCode ?? (res.provider.ok ? undefined : res.provider.failureCode);
  const r = await transition(
    { store: deps.store, clock: deps.clock, config: deps.config, reasonCodes: deps.reasonCodes },
    {
      target: s.target, kind: s.kind, event, actor: { kind: c.source === "RULE" ? "RULE" : "AI" }, caseId, expectedVersion,
      input: {
        source: c.source, verdict: c.verdict, reasonCode: c.reasonCode, failureCode: failure, zeroTolerance: c.zeroTolerance,
        labels: res.provider.ok ? res.provider.scores : null, ruleHits: s.ruleHits.map((h) => h.id), rationale: res.rationale,
        latencyMs: deps.clock.now().getTime() - started, aiProvider: "configured",
      },
    },
  );
  if (!r.applied) return { status: "skipped", reason: r.reason };
  return { status: "applied", verdict: c.verdict, transition: r.row.id };
}
export type { ProviderResult };
