import {
  CaseNotFoundError, IllegalTransitionError, TransitionConflictError, transitionCase,
  type ModerationDb, type ModerationState,
} from "@rp/core";
import type { Db } from "./db";
import { HttpError } from "./http";
import type { Actor } from "./session";

export interface QueueFilter {
  state: ModerationState;
  productId?: string;
  minScore?: number;
  maxScore?: number;
  page: number;
  pageSize: number;
}

/** Moderation queue, oldest first, with the AI score/reasons for the reviewer. */
export async function listModerationQueue(db: Db, f: QueueFilter) {
  const where = {
    state: f.state,
    ...(f.productId ? { review: { productId: f.productId } } : {}),
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
        review: { select: { id: true, productId: true, rating: true, title: true, body: true, verifiedBuyer: true, author: { select: { handle: true } } } },
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
    if (e instanceof IllegalTransitionError) throw new HttpError(409, "illegal_transition", e.message);
    if (e instanceof TransitionConflictError) throw new HttpError(409, "conflict", "Case was changed by someone else, reload");
    throw e;
  }
}
