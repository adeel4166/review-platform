/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Db } from "./db";
import { HttpError } from "./http";
import type { AppealTx } from "./appeals";

/** Read models and the content effect for the M6/M7 UI (statement of reasons, "my submissions", appeal queue, four-eyes list). */

export type NoticeKind = "UNDER_REVIEW" | "LIVE" | "NOT_PUBLISHED" | "REMOVED" | "RESTORED";

/** Pure: what the author sees for a case. `now` is injected so the appeal window is testable (TMR-011). */
export function noticeOf(c: any, decision: any | null, now: Date, appealed: boolean, restored: boolean) {
  const resolved = c.status === "RESOLVED" || c.state === "APPROVED" || c.state === "REJECTED";
  const rejected = c.outcome === "REMOVE" || c.outcome === "RESTRICT" || c.state === "REJECTED";
  const kind: NoticeKind = !resolved ? "UNDER_REVIEW" : restored ? "RESTORED" : rejected ? (c.lane === "POST_REVIEW" || c.trigger === "USER_REPORT" ? "REMOVED" : "NOT_PUBLISHED") : "LIVE";
  const expired = c.resolutionCode === "HOLD_EXPIRED";
  const until: Date | null = c.appealableUntil ? new Date(c.appealableUntil) : null;
  const windowOpen = !!until && now.getTime() < until.getTime();
  const source = expired ? "NOT_REVIEWED_IN_TIME" : decision?.source === "HUMAN" || c.decidedById ? "HUMAN" : "AUTOMATED";
  return {
    kind, source, notReviewedInTime: expired,
    publicReason: decision?.publicReason ?? c.decisionReason ?? null,
    decidedAt: c.resolvedAt ?? c.decidedAt ?? null,
    holdExpiresAt: !resolved ? c.holdExpiresAt ?? null : null,
    appealableUntil: until, canAppeal: kind !== "UNDER_REVIEW" && kind !== "LIVE" && kind !== "RESTORED" && windowOpen && !appealed,
    appealClosed: kind !== "UNDER_REVIEW" && kind !== "LIVE" && kind !== "RESTORED" && !!until && !windowOpen,
  };
}

const caseSelect = { id: true, state: true, status: true, outcome: true, lane: true, trigger: true, resolutionCode: true, resolvedAt: true, decidedAt: true, decidedById: true, decisionReason: true, holdExpiresAt: true, appealableUntil: true, version: true,
  review: { select: { id: true, title: true, authorId: true, product: { select: { name: true, slug: true } } } },
  sellerReply: { select: { id: true, authorId: true } } } as const;

export async function getDecisionNotice(db: Db, userId: string, caseId: string, now: Date) {
  const c: any = await (db as any).moderationCase.findUnique({ where: { id: caseId }, select: caseSelect });
  const authorId = c?.review?.authorId ?? c?.sellerReply?.authorId;
  if (!c || authorId !== userId) throw new HttpError(404, "not_found", "Not found");
  const [decision, appeal, strike] = await Promise.all([
    (db as any).moderationDecision.findFirst({ where: { caseId }, orderBy: { createdAt: "desc" } }),
    (db as any).appeal.findFirst({ where: { appellantId: userId, caseId } }),
    (db as any).enforcementAction.findFirst({ where: { caseId, strike: true, status: "ACTIVE" }, select: { id: true } }),
  ]);
  const restored = appeal?.status === "OVERTURNED" || appeal?.status === "PARTIALLY_OVERTURNED" && c.outcome === "APPROVE";
  const n = noticeOf(c, decision, now, !!appeal, !!restored);
  return { id: c.id, title: c.review?.title ?? null, product: c.review?.product ?? null, ...n, strike: !n.notReviewedInTime && !!strike, appealId: appeal?.id ?? null, appealStatus: appeal?.status ?? null };
}

export async function listMyCases(db: Db, userId: string, now: Date) {
  const rows: any[] = await (db as any).moderationCase.findMany({
    where: { OR: [{ review: { authorId: userId } }, { sellerReply: { authorId: userId } }]},
    orderBy: { createdAt: "desc" }, take: 50, select: caseSelect,
  });
  return { items: rows.map((c) => ({ id: c.id, title: c.review?.title ?? "Seller reply", ...noticeOf(c, null, now, false, false) })) };
}

export async function listAppealQueue(db: Db, staffId: string, now: Date) {
  const rows: any[] = await (db as any).appeal.findMany({
    where: { status: { in: ["SUBMITTED", "IN_REVIEW"] } }, orderBy: [{ priority: "desc" }, { slaDueAt: "asc" }], take: 50,
    include: { moderationCase: { select: { ...caseSelect } }, appellant: { select: { handle: true } } },
  });
  const out = [];
  for (const a of rows) {
    const deciders: string[] = a.caseId ? ((await (db as any).moderationDecision.findMany({ where: { caseId: a.caseId, source: "HUMAN" }, select: { moderatorId: true } })) as any[]).map((x) => x.moderatorId) : [];
    out.push({
      id: a.id, status: a.status, appellant: a.appellant?.handle ?? "", statement: a.statement, slaDueAt: a.slaDueAt, overdue: new Date(a.slaDueAt).getTime() < now.getTime(),
      holdExpired: a.moderationCase?.resolutionCode === "HOLD_EXPIRED", title: a.moderationCase?.review?.title ?? null, originalReason: a.moderationCase?.decisionReason ?? null,
      heldByMe: a.status === "IN_REVIEW" && a.reviewerId === staffId && !!a.leaseExpiresAt && new Date(a.leaseExpiresAt) > now, leaseExpiresAt: a.leaseExpiresAt ?? null,
      /** Guard banner (07 §7.2): the viewer decided the original, so claiming is refused server-side too. */
      conflict: deciders.includes(staffId) || a.appellantId === staffId,
    });
  }
  return { items: out };
}

export async function listPendingApprovals(db: Db, now: Date) {
  const rows: any[] = await (db as any).staffApprovalRequest.findMany({ where: { status: "PENDING", expiresAt: { gt: now } }, orderBy: { createdAt: "asc" }, take: 50 });
  return { items: rows.map((r) => ({ id: r.id, kind: r.kind, requestedById: r.requestedById, targetKey: r.targetKey, expiresAt: r.expiresAt, createdAt: r.createdAt })) };
}

/** T12 / A4: an overturned appeal puts the content live again and tells the author (CONTENT_RESTORED). Runs inside the decide transaction. */
export async function restoreContent(tx: AppealTx, a: { id: string; caseId: string | null; contentVersion: number | null }, reviewerId: string, now: Date) {
  if (!a.caseId) return;
  const t = tx as any;
  const c = await t.moderationCase.findUnique({ where: { id: a.caseId }, select: { id: true, reviewId: true, sellerReplyId: true, version: true, review: { select: { authorId: true, currentVersion: true } }, sellerReply: { select: { authorId: true } } } });
  if (!c) return;
  if (a.contentVersion !== null && a.contentVersion !== c.version) throw new HttpError(409, "version_superseded", "Content changed since the decision"); // AP-2
  if (c.reviewId) await t.review.update({ where: { id: c.reviewId }, data: { status: "PUBLISHED", publishedAt: now, publishedVersion: c.review?.currentVersion ?? null } });
  await t.moderationCase.update({ where: { id: c.id }, data: { status: "RESOLVED", state: "APPROVED", outcome: "APPROVE", resolvedAt: now, appealableUntil: null, resolutionCode: "APPEAL_OVERTURNED" } });
  await t.moderationDecision.create({ data: { caseId: c.id, transition: "A4", contentVersion: c.version, source: "HUMAN", moderatorId: reviewerId, outcome: "APPROVE", policyVersion: "appeal", createdAt: now } });
  const recipientId = c.review?.authorId ?? c.sellerReply?.authorId;
  if (recipientId) await t.notification.create({ data: { recipientId, type: "CONTENT_RESTORED", entityType: "ModerationCase", entityId: c.id, data: { caseId: c.id }, groupKey: `restored:${c.id}` } });
}
