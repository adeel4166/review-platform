/* eslint-disable @typescript-eslint/no-explicit-any */
import { REMOVAL_REASON_CODES, validateModerationConfig, type AuditRec, type CaseGuard, type CasePatch, type CaseRec, type Clock, type DecisionRec, type ModerationConfig, type OutboxRec, type Store, type Target, type TargetRec, type TxStore } from "@rp/core";
import type { AssessPort, AssessSubject } from "./assess";
import type { BurstPort } from "../trust/routing";
import { routeReview } from "../trust/routing";

/** Prisma adapter for the M6 engine's Store (conditional updates, one transaction per transition, MOD-020). `db` is a PrismaClient. */
const subjectWhere = (t: Target) => (t.type === "REVIEW" ? { reviewId: t.id } : t.type === "SELLER_REPLY" ? { sellerReplyId: t.id } : { mediaAssetId: t.id });
const unsupported = (t: Target) => new Error(`unsupported_moderation_target:${t.type}`);

function txStore(tx: any, clock: Clock): TxStore {
  return {
    async getTarget(t) {
      if (t.type === "REVIEW") {
        const r = await tx.review.findUnique({ where: { id: t.id }, select: { status: true, currentVersion: true, authorId: true, author: { select: { trustBand: true } } } });
        return r ? ({ type: t.type, id: t.id, status: r.status, version: r.currentVersion, authorId: r.authorId, trustBand: r.author?.trustBand } satisfies TargetRec) : null;
      }
      if (t.type === "SELLER_REPLY") {
        const r = await tx.sellerReply.findUnique({ where: { id: t.id }, select: { status: true, version: true, sellerId: true } });
        if (!r) return null;
        const members = await tx.sellerMember.findMany({ where: { sellerId: r.sellerId }, select: { userId: true } });
        return { type: t.type, id: t.id, status: r.status, version: r.version, authorId: null, sellerMemberIds: members.map((m: { userId: string }) => m.userId) };
      }
      throw unsupported(t);
    },
    async getCase(id) {
      const c = await tx.moderationCase.findUnique({ where: { id } });
      if (!c) return null;
      const humans = await tx.moderationDecision.findMany({ where: { caseId: id, source: "HUMAN" }, select: { moderatorId: true } });
      return { ...c, humanDeciderIds: humans.map((h: { moderatorId: string | null }) => h.moderatorId).filter(Boolean) } as CaseRec;
    },
    async setTargetStatus(t, _kind, from, to, expectedVersion) {
      const statuses = from.filter((s): s is string => s !== null);
      if (t.type === "REVIEW") {
        const r = await tx.review.updateMany({
          where: { id: t.id, status: { in: statuses }, ...(expectedVersion !== undefined ? { currentVersion: expectedVersion } : {}) },
          data: { status: to, ...(to === "PUBLISHED" ? { publishedAt: clock.now(), ...(expectedVersion !== undefined ? { publishedVersion: expectedVersion } : {}) } : {}) },
        });
        return r.count === 1;
      }
      if (t.type === "SELLER_REPLY") {
        const r = await tx.sellerReply.updateMany({ where: { id: t.id, status: { in: statuses }, ...(expectedVersion !== undefined ? { version: expectedVersion } : {}) }, data: { status: to } });
        return r.count === 1;
      }
      throw unsupported(t);
    },
    async patchCase(id, g: CaseGuard, patch: CasePatch) {
      const data: Record<string, unknown> = { ...patch };
      delete data.humanDeciderIds; // derived from decisions, not a column
      const where: Record<string, unknown> = { id };
      if (g.notResolved) where.status = { not: "RESOLVED" };
      if (g.lane) where.lane = g.lane;
      if (g.assignedToId) where.assignedToId = g.assignedToId;
      if (g.leaseAfter) where.leaseExpiresAt = { gt: g.leaseAfter };
      if (g.version !== undefined) where.version = g.version;
      if (Object.keys(data).length === 0) return (await tx.moderationCase.count({ where })) === 1;
      return (await tx.moderationCase.updateMany({ where, data })).count === 1;
    },
    async insertDecision(d: DecisionRec) {
      const data: Record<string, unknown> = { ...d };
      delete data.id;
      return (await tx.moderationDecision.create({ data, select: { id: true } })).id as string;
    },
    async insertAudit(a: AuditRec) { await tx.auditLog.create({ data: { ...a, metadata: a.metadata as never } }); },
    async insertOutbox(o: OutboxRec) { await tx.outboxEvent.create({ data: { type: o.topic, aggregateId: String(o.payload.caseId ?? o.payload.targetId ?? "").slice(0, 64), payload: o.payload } }); },
    async supersedeOtherOpenCases(t, exceptCaseId, now) {
      return (await tx.moderationCase.updateMany({ where: { ...subjectWhere(t), id: { not: exceptCaseId }, status: { not: "RESOLVED" } }, data: { status: "RESOLVED", resolutionCode: "SUPERSEDED", openKey: null, resolvedAt: now } })).count;
    },
    async hasOpenAppeal(caseId) { return (await tx.appeal.count({ where: { caseId, status: { in: ["SUBMITTED", "IN_REVIEW"] } } })) > 0; },
  };
}

export const prismaStore = (db: any, clock: Clock): Store => ({ transaction: (fn) => db.$transaction((tx: any) => fn(txStore(tx, clock))) });

/** The ACTIVE moderation config, validated. Missing/invalid -> throw (the job retries, then dead-letters to a human: fail closed). */
export async function loadActiveConfig(db: any): Promise<ModerationConfig> {
  const row = await db.moderationConfig.findFirst({ where: { status: "ACTIVE" }, select: { config: true } });
  if (!row) throw new Error("no_active_moderation_config");
  return validateModerationConfig(row.config);
}
export const REASON_CODES: ReadonlySet<string> = new Set<string>([...REMOVAL_REASON_CODES]);

/** Finds or creates the M6 case for (target, version). Idempotent under redelivery: the legacy unique key makes the upsert a no-op. */
export async function ensureCase(db: any, job: { subjectType: string; subjectId: string; version: number; trigger?: string }, clock: Clock): Promise<string | null> {
  if (job.subjectType !== "REVIEW" && job.subjectType !== "SELLER_REPLY") return null;
  const isReview = job.subjectType === "REVIEW";
  const trigger = job.trigger === "EDIT" || job.trigger === "USER_REPORT" ? job.trigger : "SUBMISSION";
  const key = isReview ? { reviewId_version_trigger_seq: { reviewId: job.subjectId, version: job.version, trigger, seq: 1 } } : { sellerReplyId_version_trigger_seq: { sellerReplyId: job.subjectId, version: job.version, trigger, seq: 1 } };
  const c = await db.moderationCase.upsert({
    where: key,
    create: { subjectType: job.subjectType, ...(isReview ? { reviewId: job.subjectId } : { sellerReplyId: job.subjectId }), version: job.version, trigger, status: "OPEN", createdAt: clock.now() },
    update: {},
    select: { id: true },
  });
  return c.id as string;
}

const mediaState = (rows: { status: string; failureReason: string | null }[]): AssessSubject["media"] =>
  rows.some((m) => m.failureReason === "MALWARE") ? "MALWARE" : rows.some((m) => m.status === "UPLOADING" || m.status === "PROCESSING") ? "PENDING" : rows.length ? "READY" : "NONE";
const LINK = /https?:\/\/|www\./i;

/** Loads everything runAssess needs; M7 routing (burst / near-duplicate) is step 1 for REVIEW targets and feeds `extraForceUnsure`. */
export function prismaAssessPort(db: any, clock: Clock, route?: { burst: BurstPort; dup?: Parameters<typeof routeReview>[0]["dup"] }): AssessPort {
  return {
    async load(caseId) {
      const c = await db.moderationCase.findUnique({ where: { id: caseId } });
      if (!c) return null;
      const base = { caseId, caseVersion: c.version as number, caseCreatedAt: c.createdAt as Date, caseResolved: c.status === "RESOLVED", lane: c.lane ?? null, kind: (c.trigger === "EDIT" ? "REVISION" : "CONTENT") as "CONTENT" | "REVISION" };
      const [priorDecisions, humanDecisions] = await Promise.all([
        db.moderationDecision.findMany({ where: { caseId }, select: { source: true, failureCode: true } }),
        db.moderationDecision.count({ where: { caseId, source: "HUMAN" } }),
      ]);
      const extra = { rescanCount: c.rescanCount ?? 0, hasHumanDecision: humanDecisions > 0, priorDecisionsAllAiUnavailable: priorDecisions.length > 0 && priorDecisions.every((d: any) => !!d.failureCode) };
      if (c.reviewId) {
        const r = await db.review.findUnique({ where: { id: c.reviewId }, select: { id: true, status: true, currentVersion: true, title: true, body: true, rating: true, productId: true, authorId: true, language: true, author: { select: { trustBand: true } }, media: { select: { status: true, failureReason: true } } } });
        if (!r) return null;
        let extraForceUnsure: string[] = [];
        if (route && r.status === "PENDING") extraForceUnsure = (await routeReview(route, clock, { productId: r.productId, reviewId: r.id, authorId: r.authorId, text: `${r.title} ${r.body}` })).extraForceUnsure;
        const lastHour = await db.review.count({ where: { productId: r.productId, createdAt: { gte: new Date(clock.now().getTime() - 3_600_000) } } });
        const prior = await db.moderationCase.count({ where: { reviewId: r.id, id: { not: caseId }, status: "RESOLVED", decisions: { some: { source: "HUMAN" } } } }).catch(() => 0);
        return { ...base, ...extra, target: { type: "REVIEW", id: r.id }, targetVersion: r.currentVersion, targetStatus: r.status, content: { title: r.title, body: r.body, rating: r.rating }, trustBand: r.author?.trustBand ?? "NEW", contentType: "REVIEW", media: mediaState(r.media ?? []), hasExternalLink: LINK.test(`${r.title} ${r.body}`), productReviewsLastHour: lastHour, resubmitAfterHuman: prior > 0, unsupportedLanguage: false, ruleHits: [], extraForceUnsure };
      }
      if (c.sellerReplyId) {
        const r = await db.sellerReply.findUnique({ where: { id: c.sellerReplyId }, select: { id: true, status: true, version: true, body: true } });
        if (!r) return null;
        return { ...base, ...extra, target: { type: "SELLER_REPLY", id: r.id }, targetVersion: r.version, targetStatus: r.status, content: { body: r.body }, trustBand: "MEDIUM", contentType: "SELLER_REPLY", media: "NONE", hasExternalLink: LINK.test(r.body), productReviewsLastHour: 0, resubmitAfterHuman: false, unsupportedLanguage: false, ruleHits: [] };
      }
      return null;
    },
  };
}
