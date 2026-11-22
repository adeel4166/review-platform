/* eslint-disable @typescript-eslint/no-explicit-any */
import { systemClock } from "@rp/core";
import { HttpError } from "./http";

/** Spec 22.2 / 25.1: erasure request (202), own-data export and the admin status list. The destructive work runs in the worker job `account.erase`. */
export async function requestAccountErasure(db: any, userId: string, confirm: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { handle: true, status: true } });
  if (!user || user.status === "DELETED") throw new HttpError(404, "not_found", "Not found");
  if (confirm !== user.handle) throw new HttpError(422, "confirmation_mismatch", "Type your handle to confirm");
  const owned: { sellerId: string }[] = await db.sellerMember.findMany({ where: { userId, role: "OWNER" }, select: { sellerId: true } });
  for (const { sellerId } of owned) {
    const members: { userId: string; role: string }[] = await db.sellerMember.findMany({ where: { sellerId } });
    if (!members.some((m) => m.role === "OWNER" && m.userId !== userId) && members.some((m) => m.userId !== userId)) throw new HttpError(409, "last_owner", "Transfer ownership first");
  }
  const now = systemClock.now();
  return db.$transaction(async (tx: any) => {
    const existing = await tx.erasureRequest.findUnique({ where: { userId } });
    if (existing) return { erasureRequestId: existing.id as string };
    await tx.user.update({ where: { id: userId }, data: { status: "DELETED" } });
    await tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    const r = await tx.erasureRequest.create({ data: { userId, requestedAt: now, steps: {} } });
    await tx.outboxEvent.create({ data: { type: "account.erase", aggregateId: r.id, payload: { erasureRequestId: r.id } } });
    return { erasureRequestId: r.id as string };
  });
}

/** Download my data: the caller's own rows only, no other users' data and no internal fields. */
export async function exportOwnData(db: any, userId: string) {
  const [profile, reviews, votes, reports, appeals, notifications] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { handle: true, displayName: true, bio: true, locale: true, timeZone: true, createdAt: true } }),
    db.review.findMany({ where: { authorId: userId }, select: { id: true, productId: true, rating: true, title: true, body: true, status: true, createdAt: true } }),
    db.reviewVote.findMany({ where: { userId }, select: { reviewId: true, value: true, createdAt: true } }),
    db.report.findMany({ where: { reporterId: userId }, select: { id: true, reviewId: true, reason: true, status: true, createdAt: true } }),
    db.appeal.findMany({ where: { appellantId: userId }, select: { id: true, caseId: true, statement: true, status: true, submittedAt: true } }),
    db.notification.findMany({ where: { recipientId: userId }, select: { id: true, type: true, readAt: true, createdAt: true } }),
  ]);
  return { exportedAt: systemClock.now().toISOString(), profile, reviews, votes, reports, appeals, notifications };
}

/** Status only (no user data): id, state, step names and times. */
export async function listErasures(db: any) {
  const rows = await db.erasureRequest.findMany({ orderBy: { requestedAt: "desc" }, take: 100 });
  return rows.map((r: any) => ({ id: r.id, requestedAt: r.requestedAt, completedAt: r.completedAt ?? null, steps: Object.keys(r.steps ?? {}) }));
}
