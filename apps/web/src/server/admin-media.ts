import { quarantineKey } from "@rp/core";
import type { Db } from "./db";
import { HttpError } from "./http";
import type { Actor } from "./session";
import type { Storage } from "./media";

/** Reasons where the original may still be in ingest and a retry makes sense. Malware/banned/format findings are never retried. */
export const RETRYABLE_REASONS = ["SCAN_UNAVAILABLE", "PROCESSING_ERROR"] as const;
const IGNORED_REASONS = ["UPLOAD_EXPIRED", "NOT_CONFIRMED"]; // abandoned slots, nothing for staff to decide
const STEP = "STAFF_DECISION";

function staff(actor: Actor) {
  if (actor.role !== "admin" && actor.role !== "super_admin") throw new HttpError(403, "forbidden", "Admin access required");
}

/**
 * Failed/flagged media that no staff member has handled yet. Metadata only: no bytes, no signed URLs, no file names, no threat
 * names (those stay in the scan log), so a quarantined file can never be rendered in the browser.
 */
export async function listMediaQueue(db: Db, actor: Actor, page: number, pageSize: number) {
  staff(actor);
  const where = { status: "FAILED" as const, failureReason: { notIn: IGNORED_REASONS }, logs: { none: { step: STEP } } };
  const [items, total] = await Promise.all([
    db.mediaAsset.findMany({
      where, orderBy: { updatedAt: "asc" }, skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, reviewId: true, kind: true, failureReason: true, createdAt: true, processedAt: true },
    }),
    db.mediaAsset.count({ where }),
  ]);
  return { items: items.map((i) => ({ ...i, retryable: (RETRYABLE_REASONS as readonly string[]).includes(i.failureReason ?? "") })), page, pageSize, total };
}

export async function decideMedia(db: Db, st: Storage, actor: Actor, assetId: string, decision: "approve" | "reject") {
  staff(actor);
  const outcome = await db.$transaction(async (t) => {
    const tx = t as unknown as Db;
    const a = await tx.mediaAsset.findUnique({ where: { id: assetId }, select: { id: true, status: true, failureReason: true, reviewId: true } });
    if (!a) throw new HttpError(404, "not_found", "Media not found");
    if (a.status !== "FAILED" || await tx.mediaProcessingLog.count({ where: { assetId, step: STEP } }) > 0) throw new HttpError(409, "invalid_transition", "Media was already handled");
    if (decision === "approve") {
      if (!(RETRYABLE_REASONS as readonly string[]).includes(a.failureReason ?? "")) throw new HttpError(409, "not_retryable", "This failure cannot be retried");
      // Conditional update: a concurrent decision gets count 0.
      const res = await tx.mediaAsset.updateMany({ where: { id: assetId, status: "FAILED" }, data: { status: "PROCESSING", failureReason: null, processedAt: null } });
      if (res.count !== 1) throw new HttpError(409, "invalid_transition", "Media was already handled");
      await tx.outboxEvent.create({ data: { type: "media.uploaded", aggregateId: assetId, payload: { assetId } } });
    }
    await tx.mediaProcessingLog.create({ data: { assetId, step: STEP, outcome: decision === "approve" ? "RETRY_REQUESTED" : "REJECTED", detail: { actorId: actor.id, reason: a.failureReason } } });
    await tx.auditLog.create({
      data: { actorType: "STAFF", actorId: actor.id, action: decision === "approve" ? "media.retry" : "media.rejected", entityType: "MediaAsset", entityId: assetId, metadata: { reviewId: a.reviewId, reason: a.failureReason } },
    });
    return { id: assetId, decision };
  });
  // Best effort after commit: drop the quarantined copy (idempotent; the retention job also removes it after 30 days).
  if (decision === "reject") await st.store.delete(st.buckets.private, quarantineKey(assetId)).catch(() => undefined);
  return outcome;
}
