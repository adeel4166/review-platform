import { transition, type Clock, type ModerationConfig, type Store, type Target, type RowKind } from "@rp/core";

export type BulkResult = "APPLIED" | "SKIPPED" | "FAILED";
export interface BulkItemRef { caseId: string; target: Target; kind: RowKind; lane: "HOLD" | "POST_REVIEW" | "REPORTED"; targetStatus: string }
export interface BulkPort {
  items(bulkOperationId: string): Promise<{ op: { requestedById: string; requesterRole: "MODERATOR" | "SENIOR_MODERATOR"; lane: BulkItemRef["lane"]; action: "approve" | "reject" | "remove" | "confirm"; reasonCode?: string; publicReason?: string }; items: BulkItemRef[] }>;
  /** Takes a 15 min lease on behalf of the requester (conditional) and releases it afterwards. */
  lease(caseId: string, userId: string, now: Date): Promise<boolean>;
  release(caseId: string, userId: string): Promise<void>;
  record(bulkOperationId: string, caseId: string, result: BulkResult, reason?: string): Promise<void>;
  complete(bulkOperationId: string, now: Date): Promise<void>;
}
export const BULK_LIMIT = 100;
const EVENT: Record<string, Record<string, "STAFF_APPROVE" | "STAFF_REJECT" | "POST_REVIEW_CONFIRM" | "POST_REVIEW_REMOVE" | "STAFF_REMOVE" | "DISMISS_REPORTS">> = {
  HOLD: { approve: "STAFF_APPROVE", reject: "STAFF_REJECT" },
  POST_REVIEW: { confirm: "POST_REVIEW_CONFIRM", remove: "POST_REVIEW_REMOVE" },
  REPORTED: { remove: "STAFF_REMOVE", approve: "DISMISS_REPORTS" },
};
/** `moderation.bulk-apply`: each item goes through transition() with its own lease; per-item result recorded. MODERATOR: approve/confirm only. */
export async function applyBulk(d: { store: Store; port: BulkPort; clock: Clock; config: ModerationConfig; reasonCodes: ReadonlySet<string> }, bulkOperationId: string): Promise<{ applied: number; skipped: number; failed: number }> {
  const { op, items } = await d.port.items(bulkOperationId);
  const out = { applied: 0, skipped: 0, failed: 0 };
  const destructive = op.action === "reject" || op.action === "remove";
  for (const it of items) {
    const event = EVENT[op.lane]?.[op.action];
    const note = async (r: BulkResult, reason?: string) => { out[r === "APPLIED" ? "applied" : r === "SKIPPED" ? "skipped" : "failed"]++; await d.port.record(bulkOperationId, it.caseId, r, reason); };
    if (!event || it.lane !== op.lane || (destructive && op.requesterRole !== "SENIOR_MODERATOR")) { await note("SKIPPED", "invalid_transition"); continue; }
    if (!(await d.port.lease(it.caseId, op.requestedById, d.clock.now()))) { await note("SKIPPED", "leased"); continue; }
    try {
      const r = await transition(d, { target: it.target, kind: it.kind, event, actor: { kind: op.requesterRole === "SENIOR_MODERATOR" ? "SMOD" : "MOD", id: op.requestedById }, caseId: it.caseId, input: { reasonCode: op.reasonCode, publicReason: op.publicReason, bulkOperationId } });
      await note(r.applied ? "APPLIED" : "SKIPPED", r.applied ? undefined : r.reason === "already_resolved" ? "resolved" : "invalid_transition");
    } catch (e) {
      const code = (e as { code?: string }).code;
      await note(code === "CONFLICT_OF_INTEREST" ? "SKIPPED" : "FAILED", code === "CONFLICT_OF_INTEREST" ? "coi" : code === "legal_hold" ? "legal_hold" : e instanceof Error && e.message.startsWith("invalid_transition") ? "invalid_transition" : undefined);
    } finally {
      await d.port.release(it.caseId, op.requestedById);
    }
  }
  await d.port.complete(bulkOperationId, d.clock.now());
  return out;
}
