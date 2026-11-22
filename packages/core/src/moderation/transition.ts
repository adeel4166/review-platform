import { assertAuditMetadataClean } from "../audit-metadata";
import { addHours, type Clock } from "../clock";
import { holdDeadline, postReviewDue, postReviewLapseAt, appealWindowEnd, reportedSlaDue, leaseEnd } from "./timers";
import type { ModerationConfig } from "./config";
import { findRows, type ActorKind, type Event, type Lane, type Row, type RowKind } from "./transitions";

export type SubjectType = "REVIEW" | "SELLER_REPLY" | "MEDIA";
export interface Target { type: SubjectType; id: string }
export interface TargetRec { type: SubjectType; id: string; status: string; version: number; authorId: string | null; sellerMemberIds?: readonly string[]; trustBand?: string }
export interface CaseRec {
  id: string; status: "OPEN" | "IN_REVIEW" | "ESCALATED" | "RESOLVED"; lane: Lane | null; version: number;
  assignedToId: string | null; leaseExpiresAt: Date | null; holdExpiresAt: Date | null; postReviewDueAt: Date | null;
  slaDueAt: Date | null; appealableUntil: Date | null; resolutionCode: string | null; legalHold: boolean; priority: number;
  openKey: string | null; humanDeciderIds: readonly string[]; configVersion?: string | null; rescanCount?: number;
}
export type CasePatch = Partial<Omit<CaseRec, "id">> & { outcome?: string; resolvedAt?: Date | null };
export interface CaseGuard { notResolved?: boolean; lane?: Lane; assignedToId?: string; leaseAfter?: Date; version?: number }
export interface DecisionRec { id?: string; caseId: string; transition: string; contentVersion: number; source: "AI" | "RULE" | "HUMAN"; moderatorId: string | null; outcome: string; verdict?: string | null; reasonCode?: string | null; publicReason?: string | null; labels?: unknown; ruleHits?: unknown; rationale?: string | null; policyVersion: string; configVersion: string | null; failureCode?: string | null; aiProvider?: string | null; aiModel?: string | null; latencyMs?: number | null; bulkOperationId?: string | null; approvalRequestId?: string | null; createdAt: Date }
export interface AuditRec { actorType: "STAFF" | "USER" | "SYSTEM" | "AI"; actorId: string | null; action: string; entityType: string; entityId: string; metadata: Record<string, unknown> }
export interface OutboxRec { topic: string; payload: Record<string, string | number | boolean | null> }

/** Transactional port (apps adapt Prisma to it; tests use MemoryStore). Every write inside `transaction` commits or rolls back together (MOD-020). */
export interface TxStore {
  getTarget(t: Target, kind: RowKind): Promise<TargetRec | null>;
  getCase(id: string): Promise<CaseRec | null>;
  /** UPDATE ... SET status = :to WHERE id AND status IN (:from) [AND version]. Returns false on 0 rows. */
  setTargetStatus(t: Target, kind: RowKind, from: readonly (string | null)[], to: string, expectedVersion?: number): Promise<boolean>;
  /** Conditional case update: 0 rows -> false (idempotent no-op, MOD-017/021, TMR-006/013). */
  patchCase(id: string, guard: CaseGuard, patch: CasePatch): Promise<boolean>;
  insertDecision(d: DecisionRec): Promise<string>;
  insertAudit(a: AuditRec): Promise<void>;
  insertOutbox(o: OutboxRec): Promise<void>;
  supersedeOtherOpenCases(t: Target, exceptCaseId: string, now: Date): Promise<number>;
  hasOpenAppeal(caseId: string): Promise<boolean>;
}
export interface Store { transaction<T>(fn: (tx: TxStore) => Promise<T>): Promise<T> }

export interface TransitionDeps {
  store: Store; clock: Clock; config: ModerationConfig;
  /** ACTIVE policy.reasonCodes (B-5). */
  reasonCodes: ReadonlySet<string>;
  /** `content.edit` limiter: 5 / rolling 24 h (MOD-015). */
  editLimit?: (userId: string) => Promise<boolean>;
  /** Post-review sampling; default samples everything the config rate says (rate 1 -> always). */
  sample?: (band: string, caseId: string) => boolean;
}
export interface DecisionInput {
  source?: "AI" | "RULE"; verdict?: "CLEAN" | "VIOLATION" | "UNSURE"; labels?: unknown; ruleHits?: unknown; rationale?: string;
  reasonCode?: string; publicReason?: string; failureCode?: string; aiProvider?: string; aiModel?: string; latencyMs?: number;
  policyVersion?: string; zeroTolerance?: boolean; bulkOperationId?: string; approvalRequestId?: string;
}
export interface TransitionRequest {
  target: Target; kind?: RowKind; event: Event; actor: { kind: ActorKind; id?: string | null }; caseId?: string;
  /** Required for assess results and timers: the version/deadline the job was scheduled with (TMR-013, MOD-025). */
  expectedVersion?: number; expectedDeadlineMs?: number; input?: DecisionInput;
  strikeNow?: boolean;
}
export type TransitionResult =
  | { applied: true; row: Row; decisionId?: string; to: string; effects: readonly string[] }
  | { applied: false; reason: "already_resolved" | "lease_not_held" | "version_superseded" | "target_changed" | "deadline_not_reached" | "deadline_changed" | "lane_mismatch" };

/** Internal: aborts (rolls back) the transaction and yields an idempotent no-op result. */
class Abort extends Error { constructor(public reason: Extract<TransitionResult, { applied: false }>["reason"]) { super(reason); } }
export class InvalidTransition extends Error { readonly code = "invalid_transition"; constructor(public kind: RowKind, public from: string | null, public event: Event) { super(`invalid_transition:${kind}:${from}:${event}`); } }
export class TransitionForbidden extends Error { constructor(public code: "forbidden" | "CONFLICT_OF_INTEREST" | "invalid_reason_code" | "smod_required" | "rate_limited" | "open_appeal" | "legal_hold" | "not_found") { super(code); } }

const ENTITY = { REVIEW: ["review", "Review"], SELLER_REPLY: ["seller_reply", "SellerReply"], MEDIA: ["media", "MediaAsset"] } as const;
const keyPart = { REVIEW: "R", SELLER_REPLY: "S", MEDIA: "M" } as const;
export const openKeyFor = (lane: string, t: Target): string => `${lane}:${keyPart[t.type]}:${t.id}`;
const isStaff = (k: ActorKind) => k === "MOD" || k === "SMOD" || k === "APPEAL_REVIEWER";

export async function transition(deps: TransitionDeps, req: TransitionRequest): Promise<TransitionResult> {
  const kind = req.kind ?? "CONTENT";
  const now = deps.clock.now();
  try {
  return await deps.store.transaction(async (tx) => {
    const target = await tx.getTarget(req.target, kind);
    const from = target?.status ?? null;
    if (!target && !(kind !== "APPEAL" && (req.event === "SUBMIT" || req.event === "AUTHOR_EDIT"))) throw new TransitionForbidden("not_found");
    const row = findRows(kind, from, req.event)[0];
    if (!row) throw new InvalidTransition(kind, from, req.event); // MOD-016: no writes
    const allowed: readonly ActorKind[] = row.actors;
    if (!allowed.includes(req.actor.kind)) throw new TransitionForbidden("forbidden");
    if (row.event === "APPEAL_OVERTURN" && kind === "APPEAL") { /* A4 shares guards with T12/T21 which the appeals service runs first */ }
    const c = req.caseId ? await tx.getCase(req.caseId) : null;
    const has = (g: string) => (row.guard as readonly string[]).includes(g);
    if (has("caseOpen") && (!c || c.status === "RESOLVED")) throw new Abort("already_resolved");
    if (c && has("lane") && c.lane !== row.lane) throw new Abort("lane_mismatch");
    if (has("versionCurrent") && target && (c ? c.version !== target.version : req.expectedVersion !== undefined && req.expectedVersion !== target.version)) throw new Abort("version_superseded");
    if (has("versionCurrent") && target && req.expectedVersion !== undefined && req.expectedVersion !== target.version) throw new Abort("version_superseded");
    if (has("reasonCode") && !(req.input?.reasonCode && deps.reasonCodes.has(req.input.reasonCode) && req.input.publicReason)) throw new TransitionForbidden("invalid_reason_code");
    if (has("coi") && target && req.actor.id && (target.authorId === req.actor.id || target.sellerMemberIds?.includes(req.actor.id) || c?.humanDeciderIds.includes(req.actor.id))) throw new TransitionForbidden("CONFLICT_OF_INTEREST");
    if (has("escalatedNeedsSmod") && c?.status === "ESCALATED" && req.actor.kind !== "SMOD") throw new TransitionForbidden("smod_required");
    if (has("editLimit") && req.actor.id && deps.editLimit && !(await deps.editLimit(req.actor.id))) throw new TransitionForbidden("rate_limited");
    if (row.id === "T20" && c) {
      if (c.legalHold) throw new TransitionForbidden("legal_hold");
      if (await tx.hasOpenAppeal(c.id)) throw new TransitionForbidden("open_appeal");
    }
    if (has("deadlineReached") && c) {
      const deadline = row.id === "T10" || row.id === "A7" ? (c.postReviewDueAt ? postReviewLapseAt(c.postReviewDueAt, deps.config) : null) : c.holdExpiresAt;
      if (!deadline || now.getTime() < deadline.getTime()) throw new Abort("deadline_not_reached"); // TMR-003
      if (req.expectedDeadlineMs !== undefined) {
        const base = row.id === "T10" ? c.postReviewDueAt : c.holdExpiresAt;
        if (base && base.getTime() !== req.expectedDeadlineMs) throw new Abort("deadline_changed"); // TMR-013, MT-1
      }
    }

    // 1) conditional content update
    if (target && from !== null) {
      const ok = await tx.setTargetStatus(req.target, kind, row.from as readonly (string | null)[], row.to, has("versionCurrent") && target ? target.version : undefined);
      if (!ok) throw new Abort("target_changed");
    } else if (kind === "CONTENT" && !target) {
      // T1 creates the content elsewhere; engine only audits it.
    }
    // 2) conditional case update (lease at commit time, AP-5)
    const staff = (req.actor.kind === "MOD" || req.actor.kind === "SMOD") && req.actor.id;
    let leaseHeld = false;
    if (c && staff && has("leaseHeld")) {
      const ok = await tx.patchCase(c.id, { notResolved: true, assignedToId: req.actor.id!, leaseAfter: now }, {});
      if (!ok) throw new Abort(c.status === "RESOLVED" ? "already_resolved" : "lease_not_held");
      leaseHeld = true;
    }

    const casePatch: CasePatch = {};
    const outbox: OutboxRec[] = [];
    const ids = { caseId: c?.id ?? null, targetId: req.target.id, targetType: req.target.type };
    const decisionSource: "AI" | "RULE" | "HUMAN" | undefined = !row.decision ? undefined : row.decision.source === "ACTOR" ? (req.actor.kind === "RULE" || req.actor.kind === "TIMER" ? "RULE" : "AI") : row.decision.source;
    const zt = !!req.input?.zeroTolerance && (row.id === "T3" || row.id === "T4v");
    for (const e of row.effects) {
      switch (e) {
        case "openHold": {
          const d = holdDeadline(now, deps.config);
          Object.assign(casePatch, { lane: "HOLD", status: "OPEN", holdExpiresAt: d, openKey: openKeyFor("HOLD", req.target) });
          outbox.push({ topic: "moderation.hold_started", payload: { ...ids, deadlineMs: d.getTime() } });
          break;
        }
        case "openPostReview": {
          const band = target?.trustBand ?? "NEW";
          const rate = deps.config.postReview.sampleRate[band as "NEW"] ?? 1;
          const sampled = rate >= 1 ? true : rate <= 0 ? false : (deps.sample?.(band, c?.id ?? "") ?? false);
          if (!sampled) { Object.assign(casePatch, { status: "RESOLVED", resolutionCode: "NOT_SAMPLED", openKey: null, resolvedAt: now, lane: null }); break; } // MOD-003
          const due = postReviewDue(now, deps.config);
          Object.assign(casePatch, { lane: "POST_REVIEW", status: "OPEN", postReviewDueAt: due, holdExpiresAt: null, openKey: openKeyFor("POST_REVIEW", req.target) });
          outbox.push({ topic: "moderation.post_review_opened", payload: { ...ids, deadlineMs: due.getTime() } });
          break;
        }
        case "resolveCase":
          if (!zt) Object.assign(casePatch, { status: "RESOLVED", openKey: null, resolvedAt: now, assignedToId: null, leaseExpiresAt: null, resolutionCode: row.decision?.resolutionCode ?? c?.resolutionCode ?? null });
          break;
        case "appealWindow": casePatch.appealableUntil = appealWindowEnd(now, deps.config); break;
        case "reportedLane": Object.assign(casePatch, { lane: "REPORTED", slaDueAt: reportedSlaDue(now, deps.config), openKey: openKeyFor("REPORTED", req.target) }); break;
        case "supersedeOtherOpenCases": if (c) await tx.supersedeOtherOpenCases(req.target, c.id, now); break;
        case "supersedeOwnCase": if (c) await tx.patchCase(c.id, { notResolved: true }, { status: "RESOLVED", resolutionCode: "SUPERSEDED", openKey: null, resolvedAt: now }); break;
        case "promoteMedia": outbox.push({ topic: "media.promote_requested", payload: ids }); break;
        case "demoteMedia": outbox.push({ topic: "media.demote_requested", payload: ids }); break;
        case "enqueueRescan": outbox.push({ topic: "moderation.rescan_requested", payload: ids }); break;
        case "strike": outbox.push({ topic: "moderation.strike_requested", payload: { ...ids, when: "NOW" } }); break;
        case "deferredStrike": if (decisionSource !== "HUMAN") outbox.push({ topic: "moderation.strike_requested", payload: { ...ids, when: "WINDOW_CLOSE" } }); break;
        case "bumpPriority": if (c) casePatch.priority = (c.priority ?? 0) + 100; break;
        case "openNewCase": outbox.push({ topic: "moderation.assess_requested", payload: { ...ids, version: (target?.version ?? 0) + 1 } }); break;
        default:
          if (e.startsWith("notify:") && e !== "notify:none") outbox.push({ topic: "notification.requested", payload: { ...ids, type: e.slice(7) } });
          else if (e.startsWith("trust:")) outbox.push({ topic: "trust.signal", payload: { ...ids, type: e.slice(6) } });
      }
    }
    if (zt && c) {
      Object.assign(casePatch, { status: "ESCALATED", legalHold: true, openKey: `ZT:${keyPart[req.target.type]}:${req.target.id}`, resolutionCode: "ZERO_TOLERANCE" });
      outbox.push({ topic: "enforcement.zero_tolerance_hold", payload: ids });
    }
    if (c && Object.keys(casePatch).length) {
      if (!(await tx.patchCase(c.id, { notResolved: true }, casePatch))) throw new Abort("already_resolved");
    }
    let decisionId: string | undefined;
    if (row.decision && c && decisionSource) {
      decisionId = await tx.insertDecision({
        caseId: c.id, transition: row.id, contentVersion: c.version, source: decisionSource,
        moderatorId: decisionSource === "HUMAN" ? req.actor.id ?? null : null, outcome: row.decision.outcome,
        verdict: req.input?.verdict ?? row.decision.verdict ?? null, reasonCode: row.decision.resolutionCode ?? req.input?.reasonCode ?? null,
        publicReason: req.input?.publicReason ?? null, labels: req.input?.labels ?? null, ruleHits: req.input?.ruleHits ?? null,
        rationale: req.input?.rationale?.slice(0, 280) ?? null, policyVersion: req.input?.policyVersion ?? deps.config.policyVersion,
        configVersion: deps.config.version, failureCode: req.input?.failureCode ?? null, aiProvider: req.input?.aiProvider ?? null,
        aiModel: req.input?.aiModel ?? null, latencyMs: req.input?.latencyMs ?? null, bulkOperationId: req.input?.bulkOperationId ?? null,
        approvalRequestId: req.input?.approvalRequestId ?? null, createdAt: now,
      });
      outbox.push({ topic: "moderation.decided", payload: { ...ids, transition: row.id, decisionId } });
    }
    // V3-06: a review entering or leaving PUBLISHED changes the summary input. Ids only; the worker debounces.
    if (req.target.type === "REVIEW" && ((kind === "CONTENT" && (row.to === "PUBLISHED" || (from as string | null) === "PUBLISHED")) || (kind === "REVISION" && (row.to as string) === "APPROVED"))) outbox.push({ topic: "review.summary_requested", payload: { reviewId: req.target.id } });
    const [prefix, entityType] = ENTITY[req.target.type];
    const meta: Record<string, unknown> = { transition: row.id, from, to: row.to, caseId: c?.id ?? null, ...(has("leaseHeld") ? { leaseHeld } : {}), ...(decisionSource ? { source: decisionSource } : {}) };
    assertAuditMetadataClean(meta as never);
    await tx.insertAudit({ actorType: req.actor.kind === "AUTHOR" || req.actor.kind === "APPELLANT" ? "USER" : isStaff(req.actor.kind) ? "STAFF" : req.actor.kind === "AI" ? "AI" : "SYSTEM", actorId: req.actor.id ?? null, action: row.auditAction.replace("<e>", prefix), entityType, entityId: req.target.id, metadata: meta });
    for (const o of outbox) await tx.insertOutbox(o);
    return { applied: true, row, decisionId, to: row.to, effects: row.effects };
  });
  } catch (e) {
    if (e instanceof Abort) return { applied: false, reason: e.reason }; // the transaction rolled back: no partial writes
    throw e;
  }
}

/** Lease helpers used by the claim routes (spec §6.2). */
export { leaseEnd, addHours };
