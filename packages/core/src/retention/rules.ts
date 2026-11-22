import type { Clock } from "../clock";
import type { RetentionConfig } from "./config";

/** Prisma-shaped client subset used by the engine (delegates by lower-camel model name). */
type Row = Record<string, unknown>;
export interface RetentionDelegate {
  findMany(a: { where: Row; select: Row; take: number; orderBy?: Row }): Promise<Row[]>;
  updateMany(a: { where: Row; data: Row }): Promise<{ count: number }>;
  deleteMany(a: { where: Row }): Promise<{ count: number }>;
}
export type RetentionDb = Record<string, RetentionDelegate>;

export type StepAction =
  | { kind: "delete" }
  | { kind: "set"; data: Row }
  /** Object-store or multi-table work (proof/media purge, audit archive): the handler receives the due ids and returns how many it finished. */
  | { kind: "handler" };
export interface RetentionStep { model: string; field: string; /** Key column handed to handlers and used for paging (default `id`). */ idField?: string; ageDays: (c: RetentionConfig) => number; where?: Row; /** Excludes rows with legalHold (all rules). */ legalHold?: boolean; action: StepAction }
export interface RetentionRule { id: string; case: string; steps: RetentionStep[] }

const DECIDED = { in: ["VERIFIED", "REJECTED"] };
/** ADR-0033 §2 / spec §22.1: one rule per row of data-model §7. */
export const RETENTION_RULES: readonly RetentionRule[] = [
  { id: "RET-PROOF-ORIG", case: "SEC-M4-09", steps: [{ model: "purchaseProof", field: "reviewedAt", ageDays: (c) => (c.PROOF_ORIGINAL_RETENTION === "APPEAL_WINDOW" ? 30 : 0), where: { status: DECIDED, originalPurgedAt: null }, legalHold: true, action: { kind: "handler" } }] },
  { id: "RET-PROOF-RED", case: "PRV-006", steps: [{ model: "purchaseProof", field: "reviewedAt", ageDays: (c) => c.RET_PROOF_REDACTED_DAYS, where: { status: DECIDED, filesPurgedAt: null }, legalHold: true, action: { kind: "handler" } }] },
  { id: "RET-PROOF-TOMB", case: "SEC-M4-09", steps: [
    { model: "purchaseProof", field: "filesPurgedAt", ageDays: (c) => c.RET_PROOF_TOMBSTONE_DAYS, where: { orderReferenceHash: { not: null } }, legalHold: true, action: { kind: "set", data: { orderReferenceHash: null } } },
    { model: "purchaseProofFile", field: "purgedAt", ageDays: (c) => c.RET_PROOF_TOMBSTONE_DAYS, where: { sha256: { not: null } }, action: { kind: "set", data: { sha256: null } } },
  ] },
  { id: "RET-CLAIM-EVID", case: "M3-Q11", steps: [{ model: "sellerOwnershipClaim", field: "updatedAt", ageDays: (c) => c.RET_EVIDENCE_DAYS, where: { status: { in: ["REJECTED", "EXPIRED", "REVOKED", "WITHDRAWN"] }, evidenceUrl: { not: null } }, action: { kind: "handler" } }] },
  { id: "RET-APPEAL-EVID", case: "-", steps: [{ model: "appeal", field: "decidedAt", ageDays: (c) => c.RET_EVIDENCE_DAYS, action: { kind: "handler" } }] },
  { id: "RET-CONTENT-DEL", case: "-", steps: [{ model: "review", field: "deletedAt", ageDays: (c) => c.RET_CONTENT_DELETED_DAYS, action: { kind: "handler" } }] },
  { id: "RET-MEDIA-REJ", case: "media §6", steps: [{ model: "moderationCase", field: "appealableUntil", ageDays: (c) => c.RET_MEDIA_REJECTED_DAYS, legalHold: true, action: { kind: "handler" } }] },
  { id: "RET-SNAPSHOT", case: "-", steps: [{ model: "moderationCase", field: "resolvedAt", ageDays: (c) => c.RET_SNAPSHOT_DAYS, where: { contentSnapshot: { not: null } }, legalHold: true, action: { kind: "set", data: { contentSnapshot: null } } }] },
  { id: "RET-SESSIONS", case: "-", steps: [{ model: "userSession", field: "absoluteExpiresAt", ageDays: (c) => c.RET_SESSION_DAYS, action: { kind: "delete" } }] },
  { id: "RET-TOKENS", case: "-", steps: [{ model: "emailVerificationToken", field: "expiresAt", ageDays: (c) => c.RET_TOKEN_DAYS, action: { kind: "delete" } }] },
  { id: "RET-IPHASH", case: "PRV-011", steps: ["userSession", "reviewVote", "report"].map((model) => ({ model, field: "createdAt", ageDays: (c: RetentionConfig) => c.RET_IPHASH_DAYS, where: { ipHash: { not: null } }, action: { kind: "set", data: { ipHash: null } } }) as RetentionStep) },
  { id: "RET-NOTIF", case: "ADR-0031", steps: [
    { model: "notification", field: "readAt", ageDays: (c) => c.RET_NOTIF_READ_DAYS, action: { kind: "delete" } },
    { model: "notification", field: "createdAt", ageDays: (c) => c.RET_NOTIF_UNREAD_DAYS, where: { readAt: null }, action: { kind: "delete" } },
  ] },
  { id: "RET-OUTBOX", case: "-", steps: [{ model: "outboxEvent", field: "publishedAt", ageDays: (c) => c.RET_OUTBOX_DAYS, action: { kind: "delete" } }] },
  { id: "RET-AUDIT", case: "P-6", steps: [{ model: "auditLog", field: "createdAt", ageDays: (c) => c.RET_AUDIT_DAYS, action: { kind: "handler" } }] },
  /** `reasonText` is NOT NULL in the schema: "null" means the empty string. */
  { id: "RET-BREAKGLASS", case: "-", steps: [{ model: "breakGlassAccess", field: "createdAt", ageDays: (c) => c.RET_BREAKGLASS_DAYS, where: { reasonText: { not: "" } }, action: { kind: "set", data: { reasonText: "" } } }] },
  { id: "RET-LSH", case: "-", steps: [{ model: "reviewLshBucket", field: "createdAt", idField: "reviewId", ageDays: (c) => c.RET_LSH_DAYS, action: { kind: "handler" } }] },
];

/** The boundary: a row is due only when `field < now - age` (strict), so a row exactly at the boundary is kept. */
export const cutoffFor = (step: RetentionStep, cfg: RetentionConfig, now: Date): Date => new Date(now.getTime() - step.ageDays(cfg) * 86_400_000);

export type RuleHandlers = Partial<Record<string, (ids: string[], cutoff: Date) => Promise<number>>>;
export interface RetentionRun { ruleId: string; affected: number }

export function stepWhere(step: RetentionStep, cutoff: Date): Row {
  return { ...(step.where ?? {}), [step.field]: { lt: cutoff }, ...(step.legalHold ? { legalHold: false } : {}) };
}

/** `maintenance.retention`: iterates the rule table in batches with the injected clock. Rows with `legalHold` are always excluded. Idempotent. */
export async function runRetention(db: RetentionDb, clock: Clock, cfg: RetentionConfig, handlers: RuleHandlers = {}, opts: { batch?: number; rules?: readonly RetentionRule[] } = {}): Promise<RetentionRun[]> {
  const batch = opts.batch ?? 500;
  const now = clock.now();
  const out: RetentionRun[] = [];
  for (const rule of opts.rules ?? RETENTION_RULES) {
    let affected = 0;
    for (const step of rule.steps) {
      const delegate = db[step.model];
      if (!delegate) throw new Error(`retention: unknown model ${step.model}`);
      const where = stepWhere(step, cutoffFor(step, cfg, now));
      const cutoff = cutoffFor(step, cfg, now);
      const idField = step.idField ?? "id";
      const handlerStep = step.action.kind === "handler";
      let after: unknown = undefined;
      for (;;) {
        // Handler steps page by key (a batch the handler skips, for example a held proof, must not starve later rows).
        const w = handlerStep && after !== undefined ? { ...where, [idField]: { gt: after } } : where;
        const rows = await delegate.findMany({ where: w, select: { [idField]: true }, take: batch, orderBy: { [idField]: "asc" } });
        if (!rows.length) break;
        const ids = rows.map((r) => String(r[idField]));
        let n: number;
        if (step.action.kind === "handler") {
          const h = handlers[rule.id];
          if (!h) break; // no handler wired: leave the rows for a later run
          n = await h(ids, cutoff);
          after = rows[rows.length - 1]![idField];
        } else if (step.action.kind === "delete") n = (await delegate.deleteMany({ where: { ...where, [idField]: { in: ids } } })).count;
        else n = (await delegate.updateMany({ where: { ...where, [idField]: { in: ids } }, data: step.action.data })).count;
        affected += n;
        if (rows.length < batch || (!handlerStep && n === 0)) break;
      }
    }
    out.push({ ruleId: rule.id, affected });
  }
  return out;
}
