import { BIO_MAX, authorizeFollow, handleChangeAllowed, profileVisible, publicProfile, type FollowTarget } from "@rp/core";
import { z } from "zod";
import type { Db } from "./db";
import { HttpError } from "./http";

const NOT_FOUND = () => new HttpError(404, "not_found", "This page isn't available");
export const followInput = z.object({ targetType: z.enum(["USER", "SELLER", "PRODUCT"]), targetId: z.string().min(1).max(64) });
export const profilePatch = z.object({
  displayName: z.string().trim().min(1).max(64).optional(), bio: z.string().max(BIO_MAX).nullable().optional(),
  handle: z.string().regex(/^[a-z0-9_]{3,32}$/).optional(),
}).strict();
const PAGE = 50;

/** Hidden when the user isn't ACTIVE or the user blocked the viewer: the same neutral 404 (PRF-001). */
async function visibleUser(db: Db, handle: string, viewerId: string | null) {
  const u = await db.user.findUnique({ where: { handle }, select: { id: true, handle: true, displayName: true, bio: true, trustBand: true, createdAt: true, status: true } });
  if (!u) throw NOT_FOUND();
  const blocked = viewerId ? !!(await db.userBlock.findUnique({ where: { blockerId_blockedId: { blockerId: u.id, blockedId: viewerId } }, select: { blockerId: true } })) : false;
  if (!profileVisible(u.status, blocked)) throw NOT_FOUND();
  return u;
}
export async function getPublicProfile(db: Db, handle: string, viewerId: string | null) {
  const u = await visibleUser(db, handle, viewerId);
  const [reviews, followers, following, votes] = await Promise.all([
    db.review.count({ where: { authorId: u.id, status: "PUBLISHED" } }),
    db.follow.count({ where: { followedUserId: u.id } }), db.follow.count({ where: { followerId: u.id, targetType: "USER" } }),
    db.reviewVote.count({ where: { review: { authorId: u.id }, value: "HELPFUL", weight: { gt: 0 }, frozen: false } }),
  ]);
  return publicProfile(u, { reviews, helpfulReceived: votes, followers, following });
}
export async function listUserReviews(db: Db, handle: string, viewerId: string | null, o: { verified?: boolean; sort?: "recent" | "helpful" }) {
  const u = await visibleUser(db, handle, viewerId);
  const rows = await db.review.findMany({
    where: { authorId: u.id, status: "PUBLISHED", ...(o.verified ? { verifiedPurchaseAt: { not: null } } : {}) },
    orderBy: o.sort === "helpful" ? [{ helpfulWeighted: "desc" }, { id: "desc" }] : [{ publishedAt: "desc" }, { id: "desc" }], take: PAGE,
    select: { id: true, rating: true, title: true, body: true, publishedAt: true, verifiedPurchaseAt: true, helpfulCount: true, product: { select: { id: true, slug: true, name: true } } },
  });
  return { items: rows.map((r) => ({ id: r.id, rating: r.rating, title: r.title, body: r.body, publishedAt: r.publishedAt, verified: !!r.verifiedPurchaseAt, helpfulCount: r.helpfulCount, product: r.product })) };
}
export async function listFollowers(db: Db, handle: string, viewerId: string | null, which: "followers" | "following", cursor?: string) {
  const u = await visibleUser(db, handle, viewerId);
  const rows = which === "followers"
    ? await db.follow.findMany({ where: { followedUserId: u.id }, orderBy: { id: "asc" }, take: PAGE + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, follower: { select: { handle: true, displayName: true, status: true } } } })
    : await db.follow.findMany({ where: { followerId: u.id, targetType: "USER" }, orderBy: { id: "asc" }, take: PAGE + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, followedUser: { select: { handle: true, displayName: true, status: true } } } });
  const page = rows.slice(0, PAGE);
  const handles = page.map((r) => ("follower" in r ? r.follower : (r as { followedUser: { handle: string; displayName: string; status: string } | null }).followedUser)).filter((x): x is { handle: string; displayName: string; status: string } => !!x && x.status === "ACTIVE").map((x) => ({ handle: x.handle, displayName: x.displayName }));
  return { items: handles, nextCursor: rows.length > PAGE ? page[page.length - 1]!.id : null };
}

export async function putFollow(db: Db, actorId: string, input: z.infer<typeof followInput>, charge?: () => Promise<void>) {
  const { targetType, targetId } = input;
  const exists = targetType === "USER" ? !!(await db.user.findFirst({ where: { id: targetId, status: "ACTIVE" }, select: { id: true } }))
    : targetType === "SELLER" ? !!(await db.seller.findUnique({ where: { id: targetId }, select: { id: true } }))
    : !!(await db.product.findFirst({ where: { id: targetId, status: "ACTIVE" }, select: { id: true } }));
  const blocked = targetType === "USER" && !!(await db.userBlock.findUnique({ where: { blockerId_blockedId: { blockerId: targetId, blockedId: actorId } }, select: { blockerId: true } }));
  const v = authorizeFollow({ actorId, targetType: targetType as FollowTarget, targetId, targetExists: exists, targetBlockedActor: blocked });
  if (!v.ok) {
    if (v.deny === "SELF_FOLLOW") throw new HttpError(422, "self_follow", "You cannot follow yourself");
    if (v.deny === "BLOCKED") throw new HttpError(403, "BLOCKED", "You cannot follow this account");
    throw NOT_FOUND();
  }
  const col = targetType === "USER" ? "followedUserId" : targetType === "SELLER" ? "followedSellerId" : "followedProductId";
  const where = { followerId: actorId, [col]: targetId };
  const existing = await db.follow.findFirst({ where, select: { id: true } });
  if (existing) return { id: existing.id, following: true, created: false }; // idempotent
  await charge?.();
  try {
    const f = await db.follow.create({ data: { followerId: actorId, targetType, [col]: targetId }, select: { id: true } });
    return { id: f.id, following: true, created: true };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") { const f = await db.follow.findFirst({ where, select: { id: true } }); return { id: f!.id, following: true, created: false }; }
    throw e;
  }
}
/** Own follows only; deleting something that is not yours or not there is the same idempotent 204. */
export async function deleteFollow(db: Db, actorId: string, id: string) {
  await db.follow.deleteMany({ where: { id, followerId: actorId } });
}

export async function blockUser(db: Db, actorId: string, targetId: string) {
  if (actorId === targetId) throw new HttpError(422, "self_block", "You cannot block yourself");
  if (!(await db.user.findUnique({ where: { id: targetId }, select: { id: true } }))) throw NOT_FOUND();
  await db.$transaction(async (tx) => {
    await tx.userBlock.upsert({ where: { blockerId_blockedId: { blockerId: actorId, blockedId: targetId } }, create: { blockerId: actorId, blockedId: targetId }, update: {} });
    // follows removed both ways in the same transaction; votes stay (votes are not social contact)
    await tx.follow.deleteMany({ where: { OR: [{ followerId: actorId, followedUserId: targetId }, { followerId: targetId, followedUserId: actorId }] } });
  });
}
export async function unblockUser(db: Db, actorId: string, targetId: string) { await db.userBlock.deleteMany({ where: { blockerId: actorId, blockedId: targetId } }); }
export async function listBlocks(db: Db, actorId: string) {
  const rows = await db.userBlock.findMany({ where: { blockerId: actorId }, orderBy: { createdAt: "desc" }, take: 200, select: { blocked: { select: { id: true, handle: true, displayName: true } } } });
  return { items: rows.map((r) => r.blocked) };
}

export async function getOwnProfile(db: Db, userId: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { handle: true, displayName: true, bio: true, trustBand: true, handleChangedAt: true } });
  return { handle: u.handle, displayName: u.displayName, bio: u.bio, band: u.trustBand, handleChangedAt: u.handleChangedAt };
}
export async function patchOwnProfile(db: Db, userId: string, p: z.infer<typeof profilePatch>, now = new Date()) {
  const cur = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { handle: true, handleChangedAt: true } });
  const data: Record<string, unknown> = {};
  if (p.displayName !== undefined) data.displayName = p.displayName;
  if (p.bio !== undefined) data.bio = p.bio;
  if (p.handle !== undefined && p.handle !== cur.handle) {
    if (!handleChangeAllowed(cur.handleChangedAt, now)) throw new HttpError(422, "handle_change_limit", "Handle can be changed once every 30 days");
    data.handle = p.handle; data.handleChangedAt = now;
  }
  try { await db.user.update({ where: { id: userId }, data }); }
  catch (e) { if ((e as { code?: string }).code === "P2002") throw new HttpError(409, "handle_taken", "That handle is taken"); throw e; }
  return getOwnProfile(db, userId);
}
