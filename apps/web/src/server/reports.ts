import type { z } from "zod";
import { isNewAccount, openReportKey, reportWeightFor } from "@rp/core";
import type { Db } from "./db";
import { HttpError } from "./http";
import type { Actor } from "./session";
import type { dismissReportsInput, removeContentInput, reportInput } from "./validation";

const notFound = () => new HttpError(404, "not_found", "Not found");
const isUnique = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
type Target = { reviewId: string } | { sellerReplyId: string };
export interface ReportCtx { ipHash?: string | null; now?: Date; charge?: () => Promise<void> }

/** 202 for new and repeated reports alike; content always stays live (F-9). `details` is never logged, queued or audited. */
export async function createReport(db: Db, reporterId: string, target: Target, input: z.infer<typeof reportInput>, ctx: ReportCtx = {}) {
  const now = ctx.now ?? new Date();
  const isReview = "reviewId" in target;
  const content = isReview
    ? await db.review.findUnique({ where: { id: target.reviewId }, select: { id: true, authorId: true, status: true } })
    : await db.sellerReply.findUnique({ where: { id: (target as { sellerReplyId: string }).sellerReplyId }, select: { id: true, authorId: true, status: true } });
  if (!content || content.status !== "PUBLISHED") throw notFound();
  const reporter = await db.user.findUnique({ where: { id: reporterId }, select: { emailVerifiedAt: true, createdAt: true, status: true } });
  if (!reporter?.emailVerifiedAt || (reporter.status ?? "ACTIVE") !== "ACTIVE") throw new HttpError(403, "EMAIL_NOT_VERIFIED", "Verify your email address first");
  if (content.authorId === reporterId) throw new HttpError(403, "SELF_REPORT", "You cannot report your own content");
  const targetWhere = isReview ? { reviewId: target.reviewId } : { sellerReplyId: (target as { sellerReplyId: string }).sellerReplyId };
  const dup = await db.report.findFirst({ where: { reporterId, ...targetWhere }, select: { id: true } });
  if (dup) return { status: "received" as const };
  await ctx.charge?.();
  const weight = reportWeightFor(isNewAccount(reporter.createdAt, now));
  const key = openReportKey(target as { reviewId?: string; sellerReplyId?: string });
  const version = isReview ? (await db.review.findUnique({ where: { id: target.reviewId }, select: { publishedVersion: true, currentVersion: true } }))?.publishedVersion ?? 1
    : (await db.sellerReply.findUnique({ where: { id: (target as { sellerReplyId: string }).sellerReplyId }, select: { version: true } }))?.version ?? 1;

  const attach = async (tx: Db): Promise<void> => {
    // Join the open report case or open one. Two concurrent first reports race on openReportKey: the loser joins the winner's case.
    let c = await tx.moderationCase.findUnique({ where: { openReportKey: key }, select: { id: true } });
    if (!c) {
      const prior = await tx.moderationCase.count({ where: { ...targetWhere, version, trigger: "USER_REPORT" } });
      c = await tx.moderationCase.create({
        data: { ...targetWhere, subjectType: isReview ? "REVIEW" : "SELLER_REPLY", version, trigger: "USER_REPORT", seq: prior + 1, state: "NEEDS_HUMAN", openReportKey: key },
        select: { id: true },
      });
    }
    await tx.report.create({ data: { reporterId, reason: input.reason, details: input.details ?? null, weight, caseId: c.id, ipHash: ctx.ipHash ?? null, ...targetWhere } });
    await tx.moderationCase.update({ where: { id: c.id }, data: { reportCount: { increment: 1 }, reportWeight: { increment: weight } } });
    await tx.auditLog.create({ data: { actorType: "USER", actorId: reporterId, action: "report.created", entityType: "Report", entityId: c.id, metadata: { targetType: isReview ? "REVIEW" : "SELLER_REPLY", reason: input.reason } } });
  };
  try {
    await db.$transaction(async (tx) => attach(tx as unknown as Db));
  } catch (e) {
    if (!isUnique(e)) throw e;
    // Either the same reporter raced themselves (idempotent) or we lost the case race: retry once, joining the winner's case.
    const again = await db.report.findFirst({ where: { reporterId, ...targetWhere }, select: { id: true } });
    if (!again) await db.$transaction(async (tx) => attach(tx as unknown as Db));
  }
  return { status: "received" as const };
}

export async function listMyReports(db: Db, reporterId: string) {
  const rows = await db.report.findMany({
    where: { reporterId }, orderBy: { createdAt: "desc" }, take: 100,
    select: { id: true, reviewId: true, sellerReplyId: true, reason: true, status: true, createdAt: true, resolvedAt: true },
  });
  return rows.map((r) => ({ id: r.id, targetType: r.reviewId ? "REVIEW" : "SELLER_REPLY", targetId: r.reviewId ?? r.sellerReplyId, reason: r.reason, status: r.status, createdAt: r.createdAt, resolvedAt: r.resolvedAt }));
}

// ---- staff ----

const requireStaff = (a: Actor) => { if (a.role !== "admin" && a.role !== "super_admin") throw new HttpError(403, "forbidden", "Admin access required"); };

type Case = { id: string; trigger: string; state: string; reviewId: string | null; sellerReplyId: string | null; version: number };
/** Loads an OPEN report case and applies the COI guard (staff is not the author nor a member of the product's seller). */
async function loadReportCase(tx: Db, actor: Actor, caseId: string): Promise<Case & { authorId: string; sellerId: string | null }> {
  const c = (await tx.moderationCase.findUnique({ where: { id: caseId }, select: { id: true, trigger: true, state: true, reviewId: true, sellerReplyId: true, version: true } })) as Case | null;
  if (!c) throw notFound();
  if (c.trigger !== "USER_REPORT" || c.state !== "NEEDS_HUMAN") throw new HttpError(409, "invalid_transition", "Not an open report case");
  let authorId: string, sellerId: string | null;
  if (c.reviewId) {
    const r = await tx.review.findUnique({ where: { id: c.reviewId }, select: { authorId: true, product: { select: { sellerId: true } } } });
    if (!r) throw notFound();
    authorId = r.authorId; sellerId = r.product?.sellerId ?? null;
  } else {
    const r = await tx.sellerReply.findUnique({ where: { id: c.sellerReplyId! }, select: { authorId: true, sellerId: true } });
    if (!r) throw notFound();
    authorId = r.authorId; sellerId = r.sellerId;
  }
  if (authorId === actor.id) throw new HttpError(403, "CONFLICT_OF_INTEREST", "You cannot moderate your own content");
  if (sellerId) {
    const m = await tx.sellerMember.findUnique({ where: { sellerId_userId: { sellerId, userId: actor.id } }, select: { userId: true } });
    if (m) throw new HttpError(403, "CONFLICT_OF_INTEREST", "You are a member of this seller");
  }
  return { ...c, authorId, sellerId };
}

/** T18: dismiss all reports; the content stays live. */
export async function dismissReports(db: Db, actor: Actor, caseId: string, input: z.infer<typeof dismissReportsInput>, now = new Date()) {
  requireStaff(actor);
  return db.$transaction(async (t) => {
    const tx = t as unknown as Db;
    const c = await loadReportCase(tx, actor, caseId);
    const res = await tx.moderationCase.updateMany({ where: { id: caseId, state: "NEEDS_HUMAN", trigger: "USER_REPORT" }, data: { state: "APPROVED", decisionReason: "REPORTS_DISMISSED", decidedById: actor.id, decidedAt: now, openReportKey: null } });
    if (res.count !== 1) throw new HttpError(409, "invalid_transition", "Case changed, reload");
    const n = await tx.report.updateMany({ where: { caseId, status: "OPEN" }, data: { status: "NO_ACTION", resolvedAt: now, resolvedById: actor.id } });
    await tx.auditLog.create({ data: { actorType: "STAFF", actorId: actor.id, action: "review.dismiss_reports", entityType: c.reviewId ? "Review" : "SellerReply", entityId: (c.reviewId ?? c.sellerReplyId)!, metadata: { caseId, reportCount: n.count, ...(input.note ? { note: input.note } : {}) } } });
    return { id: caseId, state: "APPROVED" as const };
  });
}

/** T17: remove the reported content, resolve reports, supersede other open cases, emit the statement-of-reasons notice. */
export async function removeReportedContent(db: Db, actor: Actor, caseId: string, input: z.infer<typeof removeContentInput>, now = new Date()) {
  requireStaff(actor);
  return db.$transaction(async (t) => {
    const tx = t as unknown as Db;
    const c = await loadReportCase(tx, actor, caseId);
    const isReview = !!c.reviewId;
    const upd = isReview
      ? await tx.review.updateMany({ where: { id: c.reviewId!, status: "PUBLISHED" }, data: { status: "REMOVED" } })
      : await tx.sellerReply.updateMany({ where: { id: c.sellerReplyId!, status: "PUBLISHED" }, data: { status: "REMOVED" } });
    if (upd.count !== 1) throw new HttpError(409, "invalid_transition", "Only published content can be removed");
    const res = await tx.moderationCase.updateMany({ where: { id: caseId, state: "NEEDS_HUMAN" }, data: { state: "REJECTED", decisionReason: input.reasonCode, decidedById: actor.id, decidedAt: now, openReportKey: null } });
    if (res.count !== 1) throw new HttpError(409, "invalid_transition", "Case changed, reload");
    const n = await tx.report.updateMany({ where: { caseId, status: "OPEN" }, data: { status: "ACTION_TAKEN", resolvedAt: now, resolvedById: actor.id } });
    await tx.moderationCase.updateMany({ where: { ...(isReview ? { reviewId: c.reviewId! } : { sellerReplyId: c.sellerReplyId! }), id: { not: caseId }, state: { in: ["PENDING", "AI_REVIEW", "NEEDS_HUMAN"] } }, data: { state: "SUPERSEDED", openReportKey: null } });
    await tx.enforcementAction.create({ data: { type: "CONTENT_REMOVAL", caseId, subjectUserId: c.authorId, ...(isReview ? { subjectReviewId: c.reviewId! } : {}), reasonCode: input.reasonCode, publicReason: input.publicReason, issuedById: actor.id, startsAt: now } });
    await tx.auditLog.create({ data: { actorType: "STAFF", actorId: actor.id, action: isReview ? "review.remove" : "seller_reply.removed", entityType: isReview ? "Review" : "SellerReply", entityId: (c.reviewId ?? c.sellerReplyId)!, metadata: { caseId, reasonCode: input.reasonCode, reportCount: n.count } } });
    await tx.outboxEvent.create({ data: { type: isReview ? "review.removed" : "seller_reply.removed", aggregateId: (c.reviewId ?? c.sellerReplyId)!, payload: isReview ? { reviewId: c.reviewId, caseId } : { replyId: c.sellerReplyId, caseId } } });
    return { id: caseId, state: "REJECTED" as const };
  });
}

/** An abusive report no longer counts toward the case. */
export async function rejectReport(db: Db, actor: Actor, reportId: string, now = new Date()) {
  requireStaff(actor);
  return db.$transaction(async (t) => {
    const tx = t as unknown as Db;
    const r = await tx.report.findUnique({ where: { id: reportId }, select: { id: true, status: true, caseId: true, weight: true } });
    if (!r) throw notFound();
    const res = await tx.report.updateMany({ where: { id: reportId, status: "OPEN" }, data: { status: "REJECTED", resolvedAt: now, resolvedById: actor.id } });
    if (res.count !== 1) throw new HttpError(409, "invalid_transition", "Report already resolved");
    if (r.caseId) await tx.moderationCase.update({ where: { id: r.caseId }, data: { reportCount: { decrement: 1 }, reportWeight: { decrement: r.weight } } });
    await tx.auditLog.create({ data: { actorType: "STAFF", actorId: actor.id, action: "report.rejected", entityType: "Report", entityId: reportId, metadata: { caseId: r.caseId } } });
    return { id: reportId, status: "REJECTED" as const };
  });
}

/** Staff list/detail of report cases: reason histogram and reports (reporter id only, never details in lists). */
export async function listReportCases(db: Db, page: number, pageSize: number) {
  const where = { trigger: "USER_REPORT" as const, state: "NEEDS_HUMAN" as const };
  const [items, total] = await Promise.all([
    db.moderationCase.findMany({ where, orderBy: [{ reportWeight: "desc" }, { createdAt: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, subjectType: true, reviewId: true, sellerReplyId: true, reportCount: true, reportWeight: true, createdAt: true, reports: { where: { status: "OPEN" }, select: { reason: true } } } }),
    db.moderationCase.count({ where }),
  ]);
  return { items: items.map(({ reports, ...c }) => ({ ...c, reasons: reports.reduce<Record<string, number>>((h, r) => ((h[r.reason] = (h[r.reason] ?? 0) + 1), h), {}) })), page, pageSize, total };
}
