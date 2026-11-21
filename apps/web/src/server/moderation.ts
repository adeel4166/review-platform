import {
  CaseNotFoundError, SelfDecisionError, IllegalTransitionError, TransitionConflictError, transitionCase,
  type ModerationDb, type ModerationState,
} from "@rp/core";
import { MEDIA_GET_TTL_SECONDS } from "@rp/core";
import type { Db } from "./db";
import type { Storage } from "./media";
import { HttpError } from "./http";
import type { Actor } from "./session";

export interface QueueFilter {
  state: ModerationState;
  productId?: string;
  minScore?: number;
  maxScore?: number;
  hasMedia?: boolean;
  page: number;
  pageSize: number;
}

/** Moderation queue, oldest first, with the AI score/reasons for the reviewer. */
export async function listModerationQueue(db: Db, f: QueueFilter) {
  const where = {
    state: f.state,
    ...(f.productId || f.hasMedia !== undefined
      ? { review: { ...(f.productId ? { productId: f.productId } : {}), ...(f.hasMedia !== undefined ? { media: f.hasMedia ? { some: {} } : { none: {} } } : {}) } }
      : {}),
    ...(f.minScore !== undefined || f.maxScore !== undefined
      ? { aiScore: { ...(f.minScore !== undefined ? { gte: f.minScore } : {}), ...(f.maxScore !== undefined ? { lte: f.maxScore } : {}) } }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.moderationCase.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      select: {
        id: true, state: true, version: true, aiScore: true, aiConfidence: true, aiReasons: true, aiProvider: true,
        decisionReason: true, decidedAt: true, createdAt: true,
        review: { select: { id: true, productId: true, rating: true, title: true, body: true, verifiedBuyer: true, author: { select: { handle: true } }, _count: { select: { media: true } } } },
      },
    }),
    db.moderationCase.count({ where }),
  ]);
  return { items, page: f.page, pageSize: f.pageSize, total };
}

/** Human decision on a case. Illegal transitions and lost races become 409s. */
export async function decideCase(db: Db, actor: Actor, caseId: string, to: "APPROVED" | "REJECTED", reason?: string) {
  try {
    const c = await transitionCase(db as unknown as ModerationDb, { caseId, to, actor: { type: "STAFF", id: actor.id }, reason });
    return { id: c.id, state: c.state };
  } catch (e) {
    if (e instanceof CaseNotFoundError) throw new HttpError(404, "not_found", "Moderation case not found");
    if (e instanceof SelfDecisionError) throw new HttpError(403, "self_moderation_forbidden", "You cannot moderate your own review");
    if (e instanceof IllegalTransitionError) throw new HttpError(409, "illegal_transition", e.message);
    if (e instanceof TransitionConflictError) throw new HttpError(409, "conflict", "Case was changed by someone else, reload");
    throw e;
  }
}

/** Case detail for the reviewer: full review text and media previews (short-lived signed URLs, any status). */
export async function getCaseDetail(db: Db, st: Storage, caseId: string) {
  const c = await db.moderationCase.findUnique({
    where: { id: caseId },
    select: {
      id: true, state: true, version: true, aiScore: true, aiConfidence: true, aiReasons: true, aiProvider: true,
      decisionReason: true, decidedAt: true, createdAt: true,
      review: {
        select: {
          id: true, productId: true, rating: true, title: true, body: true, verifiedBuyer: true, author: { select: { handle: true } },
          media: { select: { id: true, status: true, width: true, height: true, thumbKey: true, mediumKey: true, failureReason: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!c) throw new HttpError(404, "not_found", "Moderation case not found");
  const media = await Promise.all(
    c.review.media.map(async (m) => ({
      id: m.id, status: m.status, width: m.width, height: m.height, failureReason: m.failureReason,
      thumbUrl: m.status === "READY" && m.thumbKey ? await st.store.presignGet(st.buckets.private, m.thumbKey, MEDIA_GET_TTL_SECONDS) : null,
      mediumUrl: m.status === "READY" && m.mediumKey ? await st.store.presignGet(st.buckets.private, m.mediumKey, MEDIA_GET_TTL_SECONDS) : null,
    })),
  );
  return { ...c, review: { ...c.review, media } };
}

/** Read-only audit trail, newest first; optionally for one entity (a review id). */
export async function listAudit(db: Db, q: { entityId?: string; page: number; pageSize: number }) {
  const where = q.entityId ? { entityId: q.entityId } : {};
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where, orderBy: { id: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      select: { id: true, actorType: true, actorId: true, action: true, entityType: true, entityId: true, metadata: true, createdAt: true },
    }),
    db.auditLog.count({ where }),
  ]);
  return { items: rows.map((r) => ({ ...r, id: String(r.id) })), page: q.page, pageSize: q.pageSize, total };
}
