import type { SignalStore, SignalType, TrustResult } from "@rp/core";
import type { PrismaClient } from "@rp/db";
import type { TrustPort } from "./recompute";

const isDup = (e: unknown) => (e as { code?: string })?.code === "P2002";

/** Idempotent signal writer: the DB unique key (type, sourceType, sourceId, subjectKey) makes a retry a no-op (TRS-008). */
export const prismaSignalStore = (db: PrismaClient): SignalStore => ({
  async insertIfAbsent(r) {
    try { await db.trustSignal.create({ data: { ...r, type: r.type as SignalType } }); return true; }
    catch (e) { if (isDup(e)) return false; throw e; }
  },
  async void(m, at) {
    return (await db.trustSignal.updateMany({ where: { ...m, voidedAt: null }, data: { voidedAt: at } })).count > 0;
  },
});

const DAY = 86_400_000;
export const prismaTrustPort = (db: PrismaClient, clock: { now(): Date }): TrustPort => ({
  async userInputs(id) {
    const u = await db.user.findUnique({ where: { id }, select: { createdAt: true, emailVerifiedAt: true, trustBand: true, trustScore: true } });
    if (!u) return null;
    const now = clock.now();
    const [signals, restriction, twoFactor, reviews, verified, voteDays] = await Promise.all([
      db.trustSignal.findMany({ where: { subjectKey: `U:${id}`, occurredAt: { gte: new Date(now.getTime() - 400 * DAY) } }, select: { type: true, value: true, occurredAt: true, voidedAt: true } }),
      db.enforcementAction.count({ where: { subjectUserId: id, status: "ACTIVE", type: { in: ["POSTING_RESTRICTION", "VOTING_RESTRICTION", "SUSPENSION"] as never[] } } }),
      db.twoFactorTotp.count({ where: { userId: id, confirmedAt: { not: null } } }),
      db.review.count({ where: { authorId: id, status: "PUBLISHED" } }),
      db.trustSignal.count({ where: { subjectKey: `U:${id}`, type: "VERIFIED_PURCHASE", voidedAt: null } }),
      db.reviewVote.findMany({ where: { userId: id }, select: { createdAt: true }, take: 500 }),
    ]);
    const days = new Set(voteDays.map((v) => v.createdAt.toISOString().slice(0, 10))).size;
    return {
      createdAt: u.createdAt, emailVerified: !!u.emailVerifiedAt, twoFactor: twoFactor > 0, activeRestriction: restriction > 0, qualifyingActions: reviews + verified + days,
      signals: signals.map((s) => ({ type: s.type, value: Number(s.value), occurredAt: s.occurredAt, voidedAt: s.voidedAt })), previousBand: u.trustBand, previousScore: u.trustScore === null ? null : Number(u.trustScore),
    };
  },
  async sellerInputs(id) {
    const s = await db.seller.findUnique({ where: { id }, select: { status: true, verifiedAt: true, trustBand: true, trustScore: true } });
    if (!s) return null;
    const now = clock.now(), since = new Date(now.getTime() - 90 * DAY);
    const [signals, published, verifiedReviews, replies] = await Promise.all([
      db.trustSignal.findMany({ where: { subjectKey: `S:${id}`, occurredAt: { gte: new Date(now.getTime() - 400 * DAY) } }, select: { type: true, value: true, occurredAt: true, voidedAt: true } }),
      db.review.count({ where: { status: "PUBLISHED", product: { sellerId: id } } }),
      db.review.count({ where: { status: "PUBLISHED", verifiedPurchaseAt: { not: null }, product: { sellerId: id } } }),
      db.sellerReply.count({ where: { review: { product: { sellerId: id }, createdAt: { gte: since } }, status: "PUBLISHED" } }),
    ]);
    const recent = await db.review.count({ where: { product: { sellerId: id }, status: "PUBLISHED", createdAt: { gte: since } } });
    return {
      verified: s.status === "VERIFIED", verifiedClaimAt: s.verifiedAt, replyRate: recent ? replies / recent : 0, verifiedShare: published ? verifiedReviews / published : 0,
      suspended: s.status === "SUSPENDED", replyRestricted: false, signals: signals.map((x) => ({ type: x.type, value: Number(x.value), occurredAt: x.occurredAt, voidedAt: x.voidedAt })),
      previousBand: s.trustBand, previousScore: s.trustScore === null ? null : Number(s.trustScore),
    };
  },
  async saveUser(id, r: TrustResult, at, snapshot) {
    await db.$transaction([
      db.user.update({ where: { id }, data: { trustScore: r.score, trustBand: r.band, trustComputedAt: at } }),
      ...(snapshot ? [db.trustScoreSnapshot.create({ data: { subjectUserId: id, score: r.score, band: r.band, algorithmVersion: r.algorithmVersion, components: r.components as never, computedAt: at } })] : []),
    ]);
  },
  async saveSeller(id, r: TrustResult, at, snapshot) {
    await db.$transaction([
      db.seller.update({ where: { id }, data: { trustScore: r.score, trustBand: r.band, trustComputedAt: at } }),
      ...(snapshot ? [db.trustScoreSnapshot.create({ data: { subjectSellerId: id, score: r.score, band: r.band, algorithmVersion: r.algorithmVersion, components: r.components as never, computedAt: at } })] : []),
    ]);
  },
  async reweightVotes(userId, weight, since) {
    const r = await db.reviewVote.updateMany({ where: { userId, createdAt: { gte: since } }, data: { weight } });
    return r.count;
  },
});
