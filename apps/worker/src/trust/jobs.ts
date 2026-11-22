/* eslint-disable @typescript-eslint/no-explicit-any */
import { NearDuplicateIndex, detectVoteAnomaly, estimateJaccard, lshBuckets, minhash, systemClock, type BurstState, type Clock, type RecentVote, type TrustBand } from "@rp/core";
import type { BurstExcludePort, BurstPort } from "./routing";
import { applyBurst } from "./routing";
import { nightlyDecay, recomputeSubject } from "./recompute";
import { prismaTrustPort } from "./prisma-ports";

/** Production adapters and job bodies for M7 (SEC-M7-01). Registered from core-main.ts / processors.ts. */
export const nearDuplicateIndex = new NearDuplicateIndex(); // in-memory (tests only; production uses the shared adapter below)

/**
 * SEC-M7-03: near-duplicate index shared across processes and restarts, backed by `review_lsh_buckets`.
 * Candidates come from the bucket table (other authors only); signatures are recomputed from the candidate review text, so no schema change.
 */
export const prismaNearDuplicateIndex = (db: any) => ({
  async add(f: { reviewId: string; authorId: string; sig: Uint32Array }) {
    const createdAt = systemClock.now();
    await db.reviewLshBucket.createMany({ data: lshBuckets(f.sig).map((b) => ({ band: b.band, bucket: b.bucket, reviewId: f.reviewId, authorId: f.authorId, createdAt })), skipDuplicates: true });
  },
  async query(f: { reviewId: string; authorId: string; sig: Uint32Array }, threshold = 0.5) {
    const rows: { reviewId: string; authorId: string }[] = await db.reviewLshBucket.findMany({ where: { OR: lshBuckets(f.sig).map((b) => ({ band: b.band, bucket: b.bucket })), authorId: { not: f.authorId }, reviewId: { not: f.reviewId } }, select: { reviewId: true, authorId: true }, take: 500 });
    const byId = new Map(rows.map((r) => [r.reviewId, r.authorId]));
    if (!byId.size) return [];
    const reviews: { id: string; title: string; body: string }[] = await db.review.findMany({ where: { id: { in: [...byId.keys()] }, status: { in: ["PUBLISHED", "PENDING", "HIDDEN"] } }, select: { id: true, title: true, body: true } });
    return reviews.map((r) => ({ reviewId: r.id, authorId: byId.get(r.id)!, jaccard: estimateJaccard(f.sig, minhash(`${r.title}\n${r.body}`)) })).filter((h) => h.jaccard >= threshold);
  },
});

export const prismaBurstPort = (db: any): BurstPort => ({
  async recentReviews(productId, since) {
    const rows = await db.review.findMany({ where: { productId, createdAt: { gt: since } }, select: { id: true, createdAt: true, author: { select: { trustBand: true } } } });
    return rows.map((r: any) => ({ id: r.id, createdAt: r.createdAt, authorBand: (r.author?.trustBand ?? "NEW") as TrustBand }));
  },
  async openBurst(productId, now) {
    const b = await db.productBurst.findFirst({ where: { productId, endsAt: { gt: now } }, orderBy: { endsAt: "desc" } });
    return b ? { id: b.id, startedAt: b.startedAt, lastReviewAt: b.lastReviewAt, endsAt: b.endsAt, reviewCount: b.reviewCount, lowTrustCount: b.lowTrustCount } : null;
  },
  async saveBurst(productId, s: BurstState, existingId) {
    const data = { startedAt: s.startedAt, lastReviewAt: s.lastReviewAt, endsAt: s.endsAt, reviewCount: s.reviewCount, lowTrustCount: s.lowTrustCount };
    if (existingId) { await db.productBurst.update({ where: { id: existingId }, data }); return { id: existingId, opened: false }; }
    return { id: (await db.productBurst.create({ data: { productId, ...data } })).id as string, opened: true };
  },
});

export const prismaBurstExcludePort = (db: any): BurstExcludePort => ({
  async excludePublishedInWindow(productId, from, to, at) {
    const rows: { id: string }[] = await db.review.findMany({ where: { productId, status: "PUBLISHED", aggregateExcludedAt: null, createdAt: { gte: from, lte: to } }, select: { id: true } });
    if (!rows.length) return [];
    await db.review.updateMany({ where: { id: { in: rows.map((r) => r.id) }, aggregateExcludedAt: null }, data: { aggregateExcludedAt: at } });
    return rows.map((r) => r.id);
  },
  async bumpPostReview(reviewIds, by) {
    await db.moderationCase.updateMany({ where: { reviewId: { in: [...reviewIds] }, status: { not: "RESOLVED" }, lane: "POST_REVIEW" }, data: { priority: { increment: by } } });
  },
});

/** `trust.product-burst`: runs for products with an open burst; excludes the window's PUBLISHED reviews from aggregates (idempotent). */
export async function runProductBursts(db: any, clock: Clock): Promise<number> {
  const open: any[] = await db.productBurst.findMany({ where: { endsAt: { gt: clock.now() } } });
  let n = 0;
  for (const b of open) n += (await applyBurst(prismaBurstExcludePort(db), clock, b.productId, { startedAt: b.startedAt, lastReviewAt: b.lastReviewAt, endsAt: b.endsAt, reviewCount: b.reviewCount, lowTrustCount: b.lowTrustCount })).length;
  return n;
}

/** Vote-ring freeze (spec 16.2): sets `votesFrozenAt`, marks the window's votes frozen and recounts the public counters from counted votes. */
export async function sweepVoteAnomalies(db: any, clock: Clock): Promise<number> {
  const now = clock.now();
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const recent: { reviewId: string }[] = await db.reviewVote.findMany({ where: { createdAt: { gte: since }, review: { votesFrozenAt: null } }, select: { reviewId: true }, distinct: ["reviewId"], take: 500 });
  let frozen = 0;
  for (const { reviewId } of recent) {
    const votes: any[] = await db.reviewVote.findMany({ where: { reviewId, createdAt: { gte: since } }, select: { createdAt: true, ipHash: true, user: { select: { trustBand: true } } } });
    const rv: RecentVote[] = votes.map((v) => ({ at: v.createdAt, band: (v.user?.trustBand ?? "NEW") as TrustBand, ipHash: v.ipHash }));
    const reason = detectVoteAnomaly(rv, now);
    if (!reason) continue;
    const did = await db.$transaction(async (tx: any) => {
      const won = await tx.review.updateMany({ where: { id: reviewId, votesFrozenAt: null }, data: { votesFrozenAt: now } });
      if (won.count !== 1) return false;
      await tx.reviewVote.updateMany({ where: { reviewId, createdAt: { gte: since } }, data: { frozen: true } });
      const [h, nh] = await Promise.all([tx.reviewVote.count({ where: { reviewId, value: "HELPFUL", weight: { gt: 0 }, frozen: false } }), tx.reviewVote.count({ where: { reviewId, value: "NOT_HELPFUL", weight: { gt: 0 }, frozen: false } })]);
      await tx.review.update({ where: { id: reviewId }, data: { helpfulCount: h, notHelpfulCount: nh } });
      await tx.auditLog.create({ data: { actorType: "SYSTEM", actorId: null, action: "votes.frozen", entityType: "Review", entityId: reviewId, metadata: { reason } } });
      return true;
    });
    if (did) frozen++;
  }
  return frozen;
}

/** Nightly decay (02:00 UTC): recompute every subject that has a signal in the last 400 days. */
export async function runNightlyDecay(db: any, clock: Clock) {
  const rows: { subjectKey: string | null }[] = await db.trustSignal.findMany({ where: { subjectKey: { not: null }, occurredAt: { gte: new Date(clock.now().getTime() - 400 * 86_400_000) } }, select: { subjectKey: true }, distinct: ["subjectKey"] });
  return nightlyDecay(prismaTrustPort(db, clock), clock, rows.map((r) => r.subjectKey!));
}
export const runTrustRecompute = (db: any, clock: Clock, subjectKey: string) => recomputeSubject(prismaTrustPort(db, clock), clock, subjectKey);

/** `trust.signal` outbox payload -> the affected subject key (author for reviews, seller for replies). */
export async function subjectKeyForTarget(db: any, p: { targetType?: string; targetId?: string }): Promise<string | null> {
  if (p.targetType === "REVIEW" && p.targetId) { const r = await db.review.findUnique({ where: { id: p.targetId }, select: { authorId: true } }); return r ? `U:${r.authorId}` : null; }
  if (p.targetType === "SELLER_REPLY" && p.targetId) { const r = await db.sellerReply.findUnique({ where: { id: p.targetId }, select: { sellerId: true } }); return r ? `S:${r.sellerId}` : null; }
  return null;
}
