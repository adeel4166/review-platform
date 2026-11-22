/** Transition table as data (moderation-lifecycle §4, §4.2, §5; spec §3.1). The table IS the specification. */
export type ContentStatus = "PENDING" | "PUBLISHED" | "HIDDEN" | "REJECTED" | "REMOVED" | "DELETED";
export type RevisionStatus = "PENDING" | "HELD" | "APPROVED" | "REJECTED" | "SUPERSEDED";
export type AppealStatus = "SUBMITTED" | "IN_REVIEW" | "UPHELD" | "OVERTURNED" | "PARTIALLY_OVERTURNED" | "WITHDRAWN";
export type RowKind = "CONTENT" | "REVISION" | "APPEAL";
export type ActorKind = "AUTHOR" | "AI" | "RULE" | "TIMER" | "MOD" | "SMOD" | "APPEAL_REVIEWER" | "APPELLANT";
export type Lane = "HOLD" | "POST_REVIEW" | "REPORTED";

export const EVENTS = [
  "SUBMIT", "ASSESS_CLEAN", "ASSESS_VIOLATION", "ASSESS_UNSURE", "STAFF_APPROVE", "STAFF_REJECT", "HOLD_EXPIRE",
  "POST_REVIEW_CONFIRM", "POST_REVIEW_REMOVE", "POST_REVIEW_LAPSE", "FLAG", "RESCAN_VIOLATION", "STAFF_HIDE",
  "STAFF_RESTORE", "STAFF_REMOVE", "DISMISS_REPORTS", "APPEAL_OVERTURN", "AUTHOR_DELETE", "AUTHOR_EDIT", "AUTHOR_RESUBMIT",
  "APPEAL_SUBMIT", "APPEAL_CLAIM", "APPEAL_UPHOLD", "APPEAL_PARTIAL", "APPEAL_WITHDRAW", "APPEAL_SLA",
] as const;
export type Event = (typeof EVENTS)[number];

export type GuardId = "caseOpen" | "versionCurrent" | "leaseHeld" | "coi" | "reasonCode" | "deadlineReached" | "lane" | "escalatedNeedsSmod" | "windowOpen" | "noOpenAppeal" | "editLimit";
export type DecisionSource = "AI" | "RULE" | "HUMAN";
export type DecisionOutcome = "APPROVE" | "RESTRICT" | "REMOVE" | "ESCALATE";
export type EffectId =
  | "openHold" | "openPostReview" | "resolveCase" | "appealWindow" | "reportedLane" | "supersedeOtherOpenCases" | "supersedeOwnCase"
  | "promoteMedia" | "demoteMedia" | "strike" | "deferredStrike" | "enqueueRescan" | "bumpPriority" | "openNewCase"
  | "publishRevision" | `notify:${string}` | `trust:${string}`;

export interface Row {
  id: string;
  kind: RowKind;
  from: readonly (ContentStatus | RevisionStatus | AppealStatus | null)[];
  event: Event;
  actors: readonly ActorKind[];
  /** Case lane required on the open case (staff / timer rows). */
  lane?: Lane;
  guard: readonly GuardId[];
  to: ContentStatus | RevisionStatus | AppealStatus;
  decision?: { source: DecisionSource | "ACTOR"; outcome: DecisionOutcome; verdict?: "CLEAN" | "VIOLATION" | "UNSURE"; resolutionCode?: string };
  auditAction: string;
  effects: readonly EffectId[];
}

const AI_RULE: ActorKind[] = ["AI", "RULE"];
const STAFF: ActorKind[] = ["MOD", "SMOD"];
const leaving: EffectId[] = ["supersedeOtherOpenCases"];
const c = (r: Omit<Row, "kind">): Row => ({ kind: "CONTENT", ...r });
const rv = (r: Omit<Row, "kind">): Row => ({ kind: "REVISION", ...r });
const ap = (r: Omit<Row, "kind">): Row => ({ kind: "APPEAL", ...r });

export const ROWS: readonly Row[] = [
  c({ id: "T1", from: [null], event: "SUBMIT", actors: ["AUTHOR"], guard: [], to: "PENDING", auditAction: "<e>.submit", effects: ["notify:none"] }),
  c({ id: "T2", from: ["PENDING"], event: "ASSESS_CLEAN", actors: ["AI"], guard: ["caseOpen", "versionCurrent"], to: "PUBLISHED", decision: { source: "AI", outcome: "APPROVE", verdict: "CLEAN" }, auditAction: "<e>.auto_publish", effects: ["openPostReview", "promoteMedia", "trust:REVIEW_PUBLISHED"] }),
  c({ id: "T3", from: ["PENDING"], event: "ASSESS_VIOLATION", actors: AI_RULE, guard: ["caseOpen", "versionCurrent"], to: "REJECTED", decision: { source: "ACTOR", outcome: "REMOVE", verdict: "VIOLATION" }, auditAction: "<e>.auto_reject", effects: ["resolveCase", "appealWindow", "deferredStrike", "notify:CONTENT_REJECTED"] }),
  c({ id: "T4", from: ["PENDING"], event: "ASSESS_UNSURE", actors: AI_RULE, guard: ["caseOpen", "versionCurrent"], to: "HIDDEN", decision: { source: "ACTOR", outcome: "ESCALATE", verdict: "UNSURE" }, auditAction: "<e>.auto_hold", effects: ["openHold", "notify:CONTENT_HELD"] }),
  c({ id: "T4r", from: ["HIDDEN"], event: "ASSESS_CLEAN", actors: ["AI"], lane: "HOLD", guard: ["caseOpen", "lane"], to: "PUBLISHED", decision: { source: "AI", outcome: "APPROVE", verdict: "CLEAN" }, auditAction: "<e>.auto_publish", effects: ["openPostReview", "promoteMedia"] }),
  c({ id: "T4v", from: ["HIDDEN"], event: "ASSESS_VIOLATION", actors: AI_RULE, lane: "HOLD", guard: ["caseOpen", "lane"], to: "REJECTED", decision: { source: "ACTOR", outcome: "REMOVE", verdict: "VIOLATION" }, auditAction: "<e>.auto_reject", effects: ["resolveCase", "appealWindow", "deferredStrike", "notify:CONTENT_REJECTED"] }),
  c({ id: "T5", from: ["HIDDEN"], event: "STAFF_APPROVE", actors: STAFF, lane: "HOLD", guard: ["caseOpen", "lane", "leaseHeld", "coi", "escalatedNeedsSmod"], to: "PUBLISHED", decision: { source: "HUMAN", outcome: "APPROVE" }, auditAction: "<e>.approve", effects: ["resolveCase", "promoteMedia", "notify:CONTENT_PUBLISHED"] }),
  c({ id: "T6", from: ["HIDDEN"], event: "STAFF_REJECT", actors: STAFF, lane: "HOLD", guard: ["caseOpen", "lane", "leaseHeld", "coi", "reasonCode", "escalatedNeedsSmod"], to: "REJECTED", decision: { source: "HUMAN", outcome: "REMOVE" }, auditAction: "<e>.reject", effects: ["resolveCase", "appealWindow", "strike", "notify:CONTENT_REJECTED"] }),
  c({ id: "T7", from: ["HIDDEN"], event: "HOLD_EXPIRE", actors: ["TIMER"], lane: "HOLD", guard: ["caseOpen", "lane", "deadlineReached"], to: "REJECTED", decision: { source: "RULE", outcome: "REMOVE", resolutionCode: "HOLD_EXPIRED" }, auditAction: "<e>.hold_expire", effects: ["resolveCase", "appealWindow", "notify:CONTENT_REJECTED"] }),
  c({ id: "T8", from: ["PUBLISHED"], event: "POST_REVIEW_CONFIRM", actors: STAFF, lane: "POST_REVIEW", guard: ["caseOpen", "lane", "leaseHeld", "coi"], to: "PUBLISHED", decision: { source: "HUMAN", outcome: "APPROVE" }, auditAction: "<e>.post_review_confirm", effects: ["resolveCase"] }),
  c({ id: "T9", from: ["PUBLISHED"], event: "POST_REVIEW_REMOVE", actors: STAFF, lane: "POST_REVIEW", guard: ["caseOpen", "lane", "leaseHeld", "coi", "reasonCode"], to: "REMOVED", decision: { source: "HUMAN", outcome: "REMOVE" }, auditAction: "<e>.remove", effects: ["resolveCase", "appealWindow", "strike", "demoteMedia", "notify:CONTENT_REMOVED", "trust:CONTENT_ACTIONED_AGAINST", ...leaving] }),
  c({ id: "T10", from: ["PUBLISHED"], event: "POST_REVIEW_LAPSE", actors: ["TIMER"], lane: "POST_REVIEW", guard: ["caseOpen", "lane", "deadlineReached"], to: "PUBLISHED", decision: { source: "RULE", outcome: "APPROVE", resolutionCode: "POST_REVIEW_LAPSED" }, auditAction: "<e>.post_review_lapse", effects: ["resolveCase"] }),
  c({ id: "T11", from: ["PUBLISHED"], event: "FLAG", actors: ["RULE", ...STAFF], guard: ["caseOpen"], to: "PUBLISHED", decision: { source: "ACTOR", outcome: "ESCALATE", resolutionCode: "REPORTED" }, auditAction: "<e>.flag", effects: ["reportedLane", "enqueueRescan"] }),
  c({ id: "T12", from: ["REJECTED", "REMOVED"], event: "APPEAL_OVERTURN", actors: ["APPEAL_REVIEWER"], guard: ["leaseHeld", "coi", "versionCurrent"], to: "PUBLISHED", decision: { source: "HUMAN", outcome: "APPROVE", resolutionCode: "APPEAL_OVERTURNED" }, auditAction: "<e>.reinstate", effects: ["promoteMedia", "notify:CONTENT_RESTORED", "trust:APPEAL_OVERTURNED"] }),
  c({ id: "T13", from: ["PENDING", "HIDDEN", "PUBLISHED"], event: "AUTHOR_DELETE", actors: ["AUTHOR"], guard: [], to: "DELETED", auditAction: "<e>.delete", effects: ["supersedeOtherOpenCases", "demoteMedia"] }),
  c({ id: "T14", from: ["PENDING", "HIDDEN"], event: "AUTHOR_EDIT", actors: ["AUTHOR"], guard: ["editLimit"], to: "PENDING", auditAction: "<e>.edit", effects: ["supersedeOwnCase", "openNewCase"] }),
  c({ id: "T15", from: ["PUBLISHED"], event: "STAFF_HIDE", actors: STAFF, lane: "REPORTED", guard: ["caseOpen", "lane", "leaseHeld", "coi"], to: "HIDDEN", decision: { source: "HUMAN", outcome: "RESTRICT" }, auditAction: "<e>.hide", effects: ["reportedLane", "demoteMedia", "notify:CONTENT_HELD"] }),
  c({ id: "T15a", from: ["PUBLISHED"], event: "RESCAN_VIOLATION", actors: AI_RULE, lane: "REPORTED", guard: ["caseOpen", "lane"], to: "HIDDEN", decision: { source: "ACTOR", outcome: "RESTRICT", verdict: "VIOLATION" }, auditAction: "<e>.hide", effects: ["reportedLane", "demoteMedia", "notify:CONTENT_HELD"] }),
  c({ id: "T16", from: ["HIDDEN"], event: "STAFF_RESTORE", actors: STAFF, lane: "REPORTED", guard: ["caseOpen", "lane", "leaseHeld", "coi", "escalatedNeedsSmod"], to: "PUBLISHED", decision: { source: "HUMAN", outcome: "APPROVE" }, auditAction: "<e>.restore", effects: ["resolveCase", "promoteMedia", "notify:CONTENT_RESTORED", "notify:REPORT_RESOLVED"] }),
  c({ id: "T17", from: ["PUBLISHED", "HIDDEN"], event: "STAFF_REMOVE", actors: STAFF, lane: "REPORTED", guard: ["caseOpen", "lane", "leaseHeld", "coi", "reasonCode", "escalatedNeedsSmod"], to: "REMOVED", decision: { source: "HUMAN", outcome: "REMOVE" }, auditAction: "<e>.remove", effects: ["resolveCase", "appealWindow", "strike", "demoteMedia", "notify:CONTENT_REMOVED", "notify:REPORT_RESOLVED", "trust:CONTENT_ACTIONED_AGAINST", ...leaving] }),
  c({ id: "T18", from: ["PUBLISHED"], event: "DISMISS_REPORTS", actors: STAFF, lane: "REPORTED", guard: ["caseOpen", "lane", "leaseHeld", "coi"], to: "PUBLISHED", decision: { source: "HUMAN", outcome: "APPROVE", resolutionCode: "REPORTS_DISMISSED" }, auditAction: "<e>.dismiss_reports", effects: ["resolveCase", "appealWindow", "notify:REPORT_RESOLVED"] }),
  c({ id: "T19", from: ["REJECTED", "REMOVED"], event: "AUTHOR_DELETE", actors: ["AUTHOR"], guard: [], to: "DELETED", auditAction: "<e>.delete", effects: ["demoteMedia"] }),
  c({ id: "T20", from: ["REJECTED", "REMOVED"], event: "AUTHOR_RESUBMIT", actors: ["AUTHOR"], guard: ["noOpenAppeal", "editLimit"], to: "PENDING", auditAction: "<e>.resubmit", effects: ["openNewCase"] }),
  c({ id: "T21", from: ["PUBLISHED"], event: "APPEAL_OVERTURN", actors: ["APPEAL_REVIEWER"], guard: ["leaseHeld", "coi", "versionCurrent"], to: "REMOVED", decision: { source: "HUMAN", outcome: "REMOVE", resolutionCode: "APPEAL_OVERTURNED" }, auditAction: "<e>.remove", effects: ["appealWindow", "strike", "demoteMedia", "notify:CONTENT_REMOVED", ...leaving] }),

  rv({ id: "R1", from: [null], event: "AUTHOR_EDIT", actors: ["AUTHOR"], guard: ["editLimit"], to: "PENDING", auditAction: "review.revision_submit", effects: ["supersedeOwnCase", "openNewCase"] }),
  rv({ id: "R2", from: ["PENDING"], event: "ASSESS_CLEAN", actors: ["AI"], guard: ["caseOpen", "versionCurrent"], to: "APPROVED", decision: { source: "AI", outcome: "APPROVE", verdict: "CLEAN" }, auditAction: "review.revision_auto_publish", effects: ["publishRevision", "openPostReview"] }),
  rv({ id: "R3", from: ["PENDING"], event: "ASSESS_VIOLATION", actors: AI_RULE, guard: ["caseOpen", "versionCurrent"], to: "REJECTED", decision: { source: "ACTOR", outcome: "REMOVE", verdict: "VIOLATION" }, auditAction: "review.revision_auto_reject", effects: ["resolveCase", "appealWindow", "deferredStrike"] }),
  rv({ id: "R4", from: ["PENDING"], event: "ASSESS_UNSURE", actors: AI_RULE, guard: ["caseOpen", "versionCurrent"], to: "HELD", decision: { source: "ACTOR", outcome: "ESCALATE", verdict: "UNSURE" }, auditAction: "review.revision_auto_hold", effects: ["openHold"] }),
  rv({ id: "R5", from: ["HELD"], event: "STAFF_APPROVE", actors: STAFF, lane: "HOLD", guard: ["caseOpen", "lane", "leaseHeld", "coi", "escalatedNeedsSmod"], to: "APPROVED", decision: { source: "HUMAN", outcome: "APPROVE" }, auditAction: "review.revision_approve", effects: ["resolveCase", "publishRevision"] }),
  rv({ id: "R6", from: ["HELD"], event: "STAFF_REJECT", actors: STAFF, lane: "HOLD", guard: ["caseOpen", "lane", "leaseHeld", "coi", "reasonCode", "escalatedNeedsSmod"], to: "REJECTED", decision: { source: "HUMAN", outcome: "REMOVE" }, auditAction: "review.revision_reject", effects: ["resolveCase", "appealWindow", "strike"] }),
  rv({ id: "R7", from: ["HELD"], event: "HOLD_EXPIRE", actors: ["TIMER"], lane: "HOLD", guard: ["caseOpen", "lane", "deadlineReached"], to: "REJECTED", decision: { source: "RULE", outcome: "REMOVE", resolutionCode: "HOLD_EXPIRED" }, auditAction: "review.revision_hold_expire", effects: ["resolveCase", "appealWindow"] }),
  rv({ id: "R8", from: ["REJECTED"], event: "APPEAL_OVERTURN", actors: ["APPEAL_REVIEWER"], guard: ["leaseHeld", "coi", "versionCurrent"], to: "APPROVED", decision: { source: "HUMAN", outcome: "APPROVE", resolutionCode: "APPEAL_OVERTURNED" }, auditAction: "review.revision_reinstate", effects: ["publishRevision"] }),

  ap({ id: "A1", from: [null], event: "APPEAL_SUBMIT", actors: ["APPELLANT"], guard: ["windowOpen", "versionCurrent"], to: "SUBMITTED", auditAction: "appeal.submit", effects: ["notify:APPEAL_RECEIVED"] }),
  ap({ id: "A2", from: ["SUBMITTED", "IN_REVIEW"], event: "APPEAL_CLAIM", actors: ["APPEAL_REVIEWER"], guard: ["coi"], to: "IN_REVIEW", auditAction: "appeal.claim", effects: [] }),
  ap({ id: "A3", from: ["IN_REVIEW"], event: "APPEAL_UPHOLD", actors: ["APPEAL_REVIEWER"], guard: ["leaseHeld"], to: "UPHELD", auditAction: "appeal.uphold", effects: ["deferredStrike", "notify:APPEAL_DECIDED"] }),
  ap({ id: "A4", from: ["IN_REVIEW"], event: "APPEAL_OVERTURN", actors: ["APPEAL_REVIEWER"], guard: ["leaseHeld", "versionCurrent"], to: "OVERTURNED", auditAction: "appeal.overturn", effects: ["notify:APPEAL_DECIDED", "trust:APPEAL_OVERTURNED"] }),
  ap({ id: "A5", from: ["IN_REVIEW"], event: "APPEAL_PARTIAL", actors: ["APPEAL_REVIEWER"], guard: ["leaseHeld"], to: "PARTIALLY_OVERTURNED", auditAction: "appeal.partially_overturn", effects: ["notify:APPEAL_DECIDED"] }),
  ap({ id: "A6", from: ["SUBMITTED", "IN_REVIEW"], event: "APPEAL_WITHDRAW", actors: ["APPELLANT"], guard: [], to: "WITHDRAWN", auditAction: "appeal.withdraw", effects: [] }),
  ap({ id: "A7", from: ["SUBMITTED", "IN_REVIEW"], event: "APPEAL_SLA", actors: ["TIMER"], guard: ["deadlineReached"], to: "SUBMITTED", auditAction: "appeal.sla_breach", effects: ["bumpPriority"] }),
];

/** Rows for (kind, current status, event). Revision/content/appeal share event names, so `kind` is part of the key. */
export function findRows(kind: RowKind, from: string | null, event: Event): Row[] {
  return ROWS.filter((r) => r.kind === kind && r.event === event && (r.from as readonly (string | null)[]).includes(from));
}
export const STATUSES: Record<RowKind, readonly (string | null)[]> = {
  CONTENT: ["PENDING", "PUBLISHED", "HIDDEN", "REJECTED", "REMOVED", "DELETED"],
  REVISION: ["PENDING", "HELD", "APPROVED", "REJECTED", "SUPERSEDED"],
  APPEAL: ["SUBMITTED", "IN_REVIEW", "UPHELD", "OVERTURNED", "PARTIALLY_OVERTURNED", "WITHDRAWN"],
};
/** Statuses that start a flow (T1/R1/A1) use `null`. */
export const ENTRY_STATUS = null;
