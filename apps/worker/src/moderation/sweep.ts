import { aiPendingGuardAt, holdReminderAt, postReviewLapseAt, reached, transition, type Clock, type ModerationConfig, type RowKind, type Store, type Target } from "@rp/core";

export interface SweepCase {
  caseId: string; target: Target; kind: RowKind; status: "OPEN" | "IN_REVIEW" | "ESCALATED"; lane: "HOLD" | "POST_REVIEW" | "REPORTED" | null;
  createdAt: Date; holdExpiresAt: Date | null; postReviewDueAt: Date | null; postReviewBreachedAt: Date | null; slaDueAt: Date | null;
  priority: number; hasPendingMedia: boolean; targetStatus: string; contentVersion: number;
}
export interface SweepPendingAppeal { id: string; slaDueAt: Date; priority: number }
export interface SweepPort {
  /** Unresolved cases, oldest first, in batches (cursor = last id). */
  openCases(limit: number, afterId?: string): Promise<SweepCase[]>;
  /** Sets postReviewBreachedAt once (conditional on IS NULL) and adds +100 priority; false if already set (TMR-001). */
  markPostReviewBreached(caseId: string, now: Date): Promise<boolean>;
  /** Adds `by` priority only while priority < by (idempotent reminder, TMR-005). */
  bumpOnce(caseId: string, by: number): Promise<boolean>;
  openAppeals(limit: number): Promise<SweepPendingAppeal[]>;
  bumpAppealOnce(id: string, by: number): Promise<boolean>;
  /** Cases whose appeal window closed with a deferred AI strike outstanding and no overturn / resubmit (TMR-011). */
  closedWindowStrikes(now: Date, limit: number): Promise<{ caseId: string; userId: string; transition: string }[]>;
  issueDeferredStrike(caseId: string, userId: string, now: Date): Promise<boolean>;
  expirePendingApprovals(now: Date): Promise<number>;
}
export interface SweepDeps { store: Store; port: SweepPort; clock: Clock; config: ModerationConfig; reasonCodes: ReadonlySet<string>; alert?: (kind: string, d: Record<string, unknown>) => void; metric?: (name: string, n?: number) => void }
export interface SweepReport { aiPending: number; holdExpired: number; holdReminded: number; postReviewBreached: number; postReviewLapsed: number; reportedOverSla: number; appealSla: number; deferredStrikes: number; approvalsExpired: number }
export const SWEEP_BATCH = 200;

/** `maintenance.moderation-sweep` (spec §4.3). Every action goes through transition() or a conditional update, so it can race a delayed job safely. */
export async function runSweep(d: SweepDeps): Promise<SweepReport> {
  const rep: SweepReport = { aiPending: 0, holdExpired: 0, holdReminded: 0, postReviewBreached: 0, postReviewLapsed: 0, reportedOverSla: 0, appealSla: 0, deferredStrikes: 0, approvalsExpired: 0 };
  const now = d.clock.now();
  const tdeps = { store: d.store, clock: d.clock, config: d.config, reasonCodes: d.reasonCodes };
  const attempt = async (c: SweepCase, event: "ASSESS_UNSURE" | "HOLD_EXPIRE" | "POST_REVIEW_LAPSE") => {
    try {
      const r = await transition(tdeps, {
        target: c.target, kind: c.kind, event, caseId: c.caseId, actor: { kind: event === "ASSESS_UNSURE" ? "RULE" : "TIMER" },
        expectedVersion: event === "ASSESS_UNSURE" ? c.contentVersion : undefined,
        expectedDeadlineMs: event === "HOLD_EXPIRE" ? c.holdExpiresAt?.getTime() : event === "POST_REVIEW_LAPSE" ? c.postReviewDueAt?.getTime() : undefined,
        input: event === "ASSESS_UNSURE" ? { source: "RULE", verdict: "UNSURE", reasonCode: "AI_UNAVAILABLE", failureCode: "lost_job" } : undefined,
      });
      return r.applied;
    } catch (e) {
      if (e instanceof Error && (e.message.startsWith("invalid_transition") || e.message === "not_found")) return false; // decided meanwhile
      throw e;
    }
  };
  let after: string | undefined;
  for (;;) {
    const batch = await d.port.openCases(SWEEP_BATCH, after);
    if (!batch.length) break;
    for (const c of batch) {
      // 1) AI pending guard: 10 min, or media wait + 10 min with pending media
      if (c.lane === null && c.status === "OPEN" && reached(aiPendingGuardAt(c.createdAt, d.config, c.hasPendingMedia), d.clock) && (await attempt(c, "ASSESS_UNSURE"))) { rep.aiPending++; continue; }
      if (c.lane === "HOLD") {
        if (c.holdExpiresAt && reached(c.holdExpiresAt, d.clock)) { if (await attempt(c, "HOLD_EXPIRE")) rep.holdExpired++; continue; }
        if (c.holdExpiresAt && reached(holdReminderAt(c.holdExpiresAt, d.config), d.clock) && (await d.port.bumpOnce(c.caseId, 1000))) rep.holdReminded++;
      } else if (c.lane === "POST_REVIEW" && c.postReviewDueAt) {
        if (reached(c.postReviewDueAt, d.clock) && !c.postReviewBreachedAt && (await d.port.markPostReviewBreached(c.caseId, now))) { rep.postReviewBreached++; d.metric?.("post_review_sla_breach"); }
        if (reached(postReviewLapseAt(c.postReviewDueAt, d.config), d.clock) && (await attempt(c, "POST_REVIEW_LAPSE"))) rep.postReviewLapsed++;
      } else if (c.lane === "REPORTED" && c.slaDueAt && reached(c.slaDueAt, d.clock)) { rep.reportedOverSla++; d.alert?.("reported_over_sla", { caseId: c.caseId }); } // never an automatic outcome
      if (c.status === "ESCALATED" && c.lane === null && reached(new Date(c.createdAt.getTime() + 24 * 3_600_000), d.clock)) d.alert?.("protective_suspension_sla", { caseId: c.caseId });
    }
    after = batch[batch.length - 1]!.caseId;
    if (batch.length < SWEEP_BATCH) break;
  }
  for (const a of await d.port.openAppeals(SWEEP_BATCH)) if (reached(a.slaDueAt, d.clock) && (await d.port.bumpAppealOnce(a.id, 1000))) { rep.appealSla++; d.alert?.("appeal_sla", { appealId: a.id }); } // A7: never an outcome
  for (const s of await d.port.closedWindowStrikes(now, SWEEP_BATCH)) if (await d.port.issueDeferredStrike(s.caseId, s.userId, now)) rep.deferredStrikes++;
  rep.approvalsExpired = await d.port.expirePendingApprovals(now);
  return rep;
}
