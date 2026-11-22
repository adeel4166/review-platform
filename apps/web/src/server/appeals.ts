import { appealSla, windowOpen, type Clock, type ModerationConfig } from "./appeals-deps";
import { HttpError } from "./http";
import { requestApproval, type ApprovalTx } from "./approvals";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Appeals backend (spec §10, lifecycle §5). Persistence via a Prisma-shaped client; content effects (T12/T21/R8) are injected. */
export interface AppealTx extends ApprovalTx { report?: any; appeal: any; moderationCase: any; moderationDecision: any; enforcementAction: any }
export interface AppealDb { $transaction<T>(fn: (tx: AppealTx) => Promise<T>): Promise<T> }
export interface AppealDeps { db: AppealDb; clock: Clock; config: ModerationConfig; limit: (key: string, max: number, windowSeconds: number) => Promise<boolean>;
  /** Runs T12 / T21 / R8 for the case inside the caller's transaction (transition engine). Throws HttpError 409 version_superseded when stale (AP-2). */
  applyOverturn: (tx: AppealTx, a: { id: string; caseId: string | null; contentVersion: number | null }, reviewerId: string) => Promise<void> }

/** SEC-M6-07: the appellant's trust band always comes from the database, never from the request (AP-3, AP-7). */
export async function loadAppellant(db: AppealDb, userId: string): Promise<{ id: string; trustBand: string }> {
  const u: { trustBand?: string } | null = await db.$transaction((tx) => (tx as any).user.findUnique({ where: { id: userId }, select: { trustBand: true } }));
  return { id: userId, trustBand: u?.trustBand ?? "NEW" };
}

export async function fileAppeal(d: AppealDeps, user: { id: string; trustBand?: string }, i: { caseId: string; statement: string; asReporter?: boolean }) {
  if (i.statement.length < 10 || i.statement.length > 2000) throw new HttpError(400, "validation_error", "statement must be 10-2000 characters");
  if (!(await d.limit(`appeal.create:${user.id}`, 3, 86400))) throw new HttpError(429, "rate_limited", "Too many appeals"); // AP-3
  return d.db.$transaction(async (tx) => {
    const c = await tx.moderationCase.findUnique({ where: { id: i.caseId }, include: { review: { select: { authorId: true } }, sellerReply: { select: { authorId: true } } } });
    const decision = c && (await tx.moderationDecision.findFirst({ where: { caseId: c.id }, orderBy: { createdAt: "desc" } }));
    if (!c || !decision) throw new HttpError(404, "not_found", "Not found"); // appellant derived from the session only (AP-7)
    const isAuthor = (c.authorId ?? c.review?.authorId ?? c.sellerReply?.authorId) === user.id;
    const isReporter = !!i.asReporter && (await tx.report?.findFirst?.({ where: { caseId: c.id, reporterId: user.id } }));
    if (!isAuthor && !isReporter) throw new HttpError(404, "not_found", "Not found");
    if (!isAuthor && user.trustBand === "NEW") throw new HttpError(403, "forbidden", "Not allowed"); // AP-3: a NEW reporter cannot appeal T18
    if (!windowOpen(c.appealableUntil, d.clock)) throw new HttpError(403, "appeal_window_closed", "The appeal window has closed"); // TMR-011
    if (decision.contentVersion !== c.version) throw new HttpError(409, "version_superseded", "Decision is for an older version");
    if (await tx.appeal.findFirst({ where: { appellantId: user.id, caseId: c.id } })) throw new HttpError(409, "appeal_exists", "You already appealed this decision");
    const now = d.clock.now();
    const a = await tx.appeal.create({ data: { appellantId: user.id, caseId: c.id, contentVersion: c.version, statement: i.statement, status: "SUBMITTED", slaDueAt: appealSla(now, c.resolutionCode === "HOLD_EXPIRED", d.config), priority: c.resolutionCode === "HOLD_EXPIRED" ? 100 : 0, submittedAt: now } });
    await tx.auditLog.create({ data: { actorType: "USER", actorId: user.id, action: "appeal.submit", entityType: "Appeal", entityId: a.id, metadata: { caseId: c.id } } });
    await tx.outboxEvent.create({ data: { type: "appeal.submitted", aggregateId: a.id, payload: { appealId: a.id } } });
    return { id: a.id as string };
  });
}

/** Appellant DTO (AP-4): no reporter id, staff id, AI score or internal note. */
export const appealDto = (a: any, c: any) => ({ id: a.id, status: a.status, submittedAt: a.submittedAt, decidedAt: a.decidedAt ?? null, decisionNote: a.status === "SUBMITTED" || a.status === "IN_REVIEW" ? null : a.decisionNote ?? null, publicReason: c?.publicReason ?? null, decisionSource: c?.source === "HUMAN" ? "HUMAN" : c?.resolutionCode === "HOLD_EXPIRED" ? "NOT_REVIEWED_IN_TIME" : "AUTOMATED", appealableUntil: c?.appealableUntil ?? null });

export async function getOwnAppeal(db: AppealDb, userId: string, id: string) {
  return db.$transaction(async (tx) => {
    const a = await tx.appeal.findUnique({ where: { id } });
    if (!a || a.appellantId !== userId) throw new HttpError(404, "not_found", "Not found"); // APL-001
    return appealDto(a, a.caseId ? await tx.moderationCase.findUnique({ where: { id: a.caseId } }) : null);
  });
}
export async function withdrawAppeal(d: AppealDeps, userId: string, id: string) {
  return d.db.$transaction(async (tx) => {
    const a = await tx.appeal.findUnique({ where: { id } });
    if (!a || a.appellantId !== userId) throw new HttpError(404, "not_found", "Not found");
    const r = await tx.appeal.updateMany({ where: { id, status: { in: ["SUBMITTED", "IN_REVIEW"] } }, data: { status: "WITHDRAWN", leaseExpiresAt: null } });
    if (r.count !== 1) throw new HttpError(409, "conflict", "Appeal already decided");
    await tx.auditLog.create({ data: { actorType: "USER", actorId: userId, action: "appeal.withdraw", entityType: "Appeal", entityId: id, metadata: {} } });
    return { id, status: "WITHDRAWN" };
  });
}
/** A2: claim with a 15 min lease. Reviewer must not be the appellant, a human decider on the case, or the enforcement issuer (COI). */
export async function claimAppeal(d: AppealDeps, reviewerId: string, id: string) {
  return d.db.$transaction(async (tx) => {
    const a = await tx.appeal.findUnique({ where: { id } });
    if (!a) throw new HttpError(404, "not_found", "Not found");
    const deciders: string[] = a.caseId ? (await tx.moderationDecision.findMany({ where: { caseId: a.caseId, source: "HUMAN" } })).map((x: any) => x.moderatorId) : [];
    const issuer = a.enforcementActionId ? (await tx.enforcementAction.findUnique({ where: { id: a.enforcementActionId } }))?.issuedById : null;
    if (reviewerId === a.appellantId || deciders.includes(reviewerId) || issuer === reviewerId) throw new HttpError(403, "CONFLICT_OF_INTEREST", "CONFLICT_OF_INTEREST");
    const now = d.clock.now();
    const r = await tx.appeal.updateMany({ where: { id, status: { in: ["SUBMITTED", "IN_REVIEW"] }, OR: [{ reviewerId: null }, { reviewerId }, { leaseExpiresAt: { lt: now } }] }, data: { status: "IN_REVIEW", reviewerId, leaseExpiresAt: new Date(now.getTime() + 15 * 60_000) } });
    if (r.count !== 1) throw new HttpError(409, "lease_not_held", "Appeal is leased by someone else");
    await tx.auditLog.create({ data: { actorType: "STAFF", actorId: reviewerId, action: "appeal.claim", entityType: "Appeal", entityId: id, metadata: {} } });
    return { id };
  });
}
/** A3 / A4 / A5. Lease is re-checked at commit; `decisionNote` is immutable afterwards (AP-6). BAN / SELLER_SUSPENSION overturns need four-eyes (AP-1). */
export async function decideAppeal(d: AppealDeps, reviewerId: string, id: string, i: { outcome: "UPHELD" | "OVERTURNED" | "PARTIALLY_OVERTURNED"; decisionNote: string }) {
  if (i.decisionNote.trim().length < 1) throw new HttpError(400, "validation_error", "decisionNote required");
  return d.db.$transaction(async (tx) => {
    const a = await tx.appeal.findUnique({ where: { id } });
    if (!a) throw new HttpError(404, "not_found", "Not found");
    const now = d.clock.now();
    if (a.status !== "IN_REVIEW" || a.reviewerId !== reviewerId || !a.leaseExpiresAt || a.leaseExpiresAt <= now) throw new HttpError(409, "lease_not_held", "lease_not_held");
    if (i.outcome === "OVERTURNED" && a.enforcementActionId) {
      const e = await tx.enforcementAction.findUnique({ where: { id: a.enforcementActionId } });
      if (e && (e.type === "BAN" || e.type === "SELLER_SUSPENSION")) {
        const approvalId = await requestApproval(tx, d.clock, "ENFORCEMENT_OVERTURN_MAJOR", reviewerId, `appeal:${id}`, { appealId: id });
        return { status: 202 as const, approvalRequestId: approvalId };
      }
    }
    if (i.outcome === "OVERTURNED") await d.applyOverturn(tx, { id, caseId: a.caseId ?? null, contentVersion: a.contentVersion ?? null }, reviewerId);
    const r = await tx.appeal.updateMany({ where: { id, status: "IN_REVIEW", reviewerId, decisionNote: null }, data: { status: i.outcome, decisionNote: i.decisionNote, decidedAt: now, leaseExpiresAt: null } });
    if (r.count !== 1) throw new HttpError(409, "conflict", "Already decided");
    await tx.auditLog.create({ data: { actorType: "STAFF", actorId: reviewerId, action: i.outcome === "UPHELD" ? "appeal.uphold" : i.outcome === "OVERTURNED" ? "appeal.overturn" : "appeal.partially_overturn", entityType: "Appeal", entityId: id, metadata: { outcome: i.outcome } } });
    await tx.outboxEvent.create({ data: { type: "appeal.decided", aggregateId: id, payload: { appealId: id, outcome: i.outcome } } });
    return { status: 200 as const, id, outcome: i.outcome };
  });
}
