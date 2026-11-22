import type { Clock } from "../clock";

export type SignalType =
  | "MALWARE_UPLOAD" | "DUPLICATE_PROOF_DETECTED" | "VERIFIED_PURCHASE" | "PROOF_REJECTED_FRAUD" | "REVIEW_PUBLISHED" | "REVIEW_REMOVED"
  | "HELPFUL_VOTE_RECEIVED" | "NOT_HELPFUL_VOTE_RECEIVED" | "REPORT_UPHELD" | "REPORT_REJECTED" | "CONTENT_ACTIONED_AGAINST" | "ENFORCEMENT_ACTION"
  | "APPEAL_OVERTURNED" | "SELLER_REPLY_PUBLISHED" | "SELLER_REPLY_REMOVED" | "VELOCITY_ANOMALY" | "NEAR_DUPLICATE_TEXT" | "LINKED_ACCOUNT_SUSPECTED";

export interface SignalDraft { type: SignalType; sourceType: string; sourceId: string; subject: { kind: "U" | "S"; id: string }; value?: number }
export const subjectKey = (s: SignalDraft["subject"]) => `${s.kind}:${s.id}`;

/** Domain events that produce signals (spec 15.2). `transition` is the T/R id of the content state machine. */
export type TrustEvent =
  | { kind: "transition"; transition: string; target: "Review" | "SellerReply"; targetId: string; authorId?: string; sellerId?: string; decisionId?: string }
  | { kind: "media.rejected"; reason: string; assetId: string; uploaderId: string }
  | { kind: "enforcement.issued"; enforcementId: string; subjectUserId: string; type: string }
  | { kind: "appeal.overturned"; appealId: string; appellantId: string; overturnedDecisionId: string; overturnedAuthorId: string }
  | { kind: "report.resolved"; reportId: string; reporterId: string; outcome: "ABUSIVE" | "UPHELD" | "OTHER" }
  | { kind: "proof.decided"; proofId: string; submitterId: string; outcome: "VERIFIED" | "REJECTED_FRAUD" }
  | { kind: "votes.daily"; yyyymmdd: string; authorId: string; weightedNet: number }
  | { kind: "detector"; runId: string; type: "VELOCITY_ANOMALY" | "NEAR_DUPLICATE_TEXT" | "LINKED_ACCOUNT_SUSPECTED"; userId?: string; sellerId?: string };

const PUBLISH = new Set(["T2", "T5", "T12", "T16", "T4r", "R2", "R5", "R8"]);
const ACTIONED = new Set(["T9", "T17", "T21"]); // not T15: a hide is reversible by T16
const SELLER_PUBLISH = new Set(["T2"]);
const ENF_VALUE: Record<string, number> = { WARNING: -5, SUSPENSION: -30 };

/** Pure mapping from event to signal drafts. Not written: HOLD_EXPIRED (T7/R7), POST_REVIEW_LAPSED (T10), author deletes (T13/T19). */
export function signalsFor(e: TrustEvent): SignalDraft[] {
  switch (e.kind) {
    case "transition": {
      const out: SignalDraft[] = [];
      if (e.target === "Review" && e.authorId && PUBLISH.has(e.transition)) out.push({ type: "REVIEW_PUBLISHED", sourceType: "Review", sourceId: e.targetId, subject: { kind: "U", id: e.authorId } });
      if (e.target === "SellerReply" && e.sellerId && SELLER_PUBLISH.has(e.transition)) out.push({ type: "SELLER_REPLY_PUBLISHED", sourceType: "SellerReply", sourceId: e.targetId, subject: { kind: "S", id: e.sellerId } });
      if (ACTIONED.has(e.transition) && e.decisionId) {
        if (e.target === "SellerReply" && e.sellerId) out.push({ type: "SELLER_REPLY_REMOVED", sourceType: "ModerationDecision", sourceId: e.decisionId, subject: { kind: "S", id: e.sellerId } });
        else if (e.authorId) out.push({ type: "CONTENT_ACTIONED_AGAINST", sourceType: "ModerationDecision", sourceId: e.decisionId, subject: { kind: "U", id: e.authorId } });
      }
      return out;
    }
    case "media.rejected":
      return e.reason === "MALWARE" ? [{ type: "MALWARE_UPLOAD", sourceType: "MediaAsset", sourceId: e.assetId, subject: { kind: "U", id: e.uploaderId } }] : [];
    case "enforcement.issued":
      return [{ type: "ENFORCEMENT_ACTION", sourceType: "EnforcementAction", sourceId: e.enforcementId, subject: { kind: "U", id: e.subjectUserId }, value: ENF_VALUE[e.type] ?? -15 }];
    case "appeal.overturned":
      return [{ type: "APPEAL_OVERTURNED", sourceType: "Appeal", sourceId: e.appealId, subject: { kind: "U", id: e.appellantId }, value: 0 }];
    case "report.resolved":
      return e.outcome === "OTHER" ? [] : [{ type: e.outcome === "UPHELD" ? "REPORT_UPHELD" : "REPORT_REJECTED", sourceType: "Report", sourceId: e.reportId, subject: { kind: "U", id: e.reporterId } }];
    case "proof.decided":
      return [{ type: e.outcome === "VERIFIED" ? "VERIFIED_PURCHASE" : "PROOF_REJECTED_FRAUD", sourceType: "PurchaseProof", sourceId: e.proofId, subject: { kind: "U", id: e.submitterId } }];
    case "votes.daily":
      return [{ type: "HELPFUL_VOTE_RECEIVED", sourceType: "VoteDay", sourceId: e.yyyymmdd, subject: { kind: "U", id: e.authorId }, value: e.weightedNet }];
    case "detector": {
      const subject = e.sellerId ? { kind: "S" as const, id: e.sellerId } : { kind: "U" as const, id: e.userId! };
      return [{ type: e.type, sourceType: "DetectorRun", sourceId: e.runId, subject }];
    }
  }
}

/** Port: the unique key (type, sourceType, sourceId, subjectKey) makes writes idempotent (TRS-008). */
export interface SignalStore {
  insertIfAbsent(row: { type: SignalType; sourceType: string; sourceId: string; subjectKey: string; userId: string | null; sellerId: string | null; value: number; occurredAt: Date }): Promise<boolean>;
  void(match: { type: SignalType; sourceType: string; sourceId: string; subjectKey: string }, at: Date): Promise<boolean>;
}
export interface SignalResult { written: SignalDraft[]; duplicates: SignalDraft[]; subjects: string[] }

export async function recordSignals(store: SignalStore, clock: Clock, e: TrustEvent): Promise<SignalResult> {
  const now = clock.now();
  const written: SignalDraft[] = [], duplicates: SignalDraft[] = [];
  for (const d of signalsFor(e)) {
    const ok = await store.insertIfAbsent({ type: d.type, sourceType: d.sourceType, sourceId: d.sourceId, subjectKey: subjectKey(d.subject), userId: d.subject.kind === "U" ? d.subject.id : null, sellerId: d.subject.kind === "S" ? d.subject.id : null, value: d.value ?? 1, occurredAt: now });
    (ok ? written : duplicates).push(d);
  }
  // A4 overturn voids the signal of the overturned decision (weight-0 APPEAL_OVERTURNED above is audit only).
  if (e.kind === "appeal.overturned") {
    await store.void({ type: "CONTENT_ACTIONED_AGAINST", sourceType: "ModerationDecision", sourceId: e.overturnedDecisionId, subjectKey: `U:${e.overturnedAuthorId}` }, now);
  }
  return { written, duplicates, subjects: [...new Set(signalsFor(e).map((d) => subjectKey(d.subject)))] };
}

/** Debounced recompute job id (spec 15.3): one per subject per minute. */
export const recomputeJobId = (key: string, now: Date) => `trust-rc__${key}__${Math.floor(now.getTime() / 60_000)}`;

export class MemorySignalStore implements SignalStore {
  rows: { type: SignalType; sourceType: string; sourceId: string; subjectKey: string; userId: string | null; sellerId: string | null; value: number; occurredAt: Date; voidedAt?: Date }[] = [];
  async insertIfAbsent(r: Parameters<SignalStore["insertIfAbsent"]>[0]) {
    if (this.rows.some((x) => x.type === r.type && x.sourceType === r.sourceType && x.sourceId === r.sourceId && x.subjectKey === r.subjectKey)) return false;
    this.rows.push({ ...r }); return true;
  }
  async void(m: Parameters<SignalStore["void"]>[0], at: Date) {
    const r = this.rows.find((x) => x.type === m.type && x.sourceType === m.sourceType && x.sourceId === m.sourceId && x.subjectKey === m.subjectKey && !x.voidedAt);
    if (!r) return false; r.voidedAt = at; return true;
  }
}
