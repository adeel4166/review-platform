import type { SellerMemberRole } from "@rp/core";
import type { Db } from "./db";
import { requireSellerPermission } from "./sellers";
import type { Actor } from "./session";

/**
 * Read models for the seller pages. Everything the UI shows about verification (badge, domain, status) is derived here, on the
 * server, from database rows. The client never sends or computes it (SEL-009, O-3, O-7).
 */

export interface PublicSeller {
  id: string; slug: string; name: string; description: string | null; websiteUrl: string | null;
  status: "UNVERIFIED" | "PENDING_VERIFICATION" | "VERIFIED" | "SUSPENDED" | "CLOSED";
  /** Punycode (A-label) form exactly as stored by the claim service. Never converted to Unicode for display (homograph defence). */
  verifiedDomain: string | null;
  products: { id: string; slug: string; name: string }[];
}

export async function getPublicSeller(db: Pick<Db, "seller" | "product">, slug: string): Promise<PublicSeller | null> {
  const s = await db.seller.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, description: true, websiteUrl: true, status: true, verifiedDomain: true, verifiedClaimId: true, closedAt: true },
  });
  if (!s || s.closedAt || s.status === "CLOSED") return null;
  const products = await db.product.findMany({ where: { sellerId: s.id, status: "ACTIVE" }, select: { id: true, slug: true, name: true }, orderBy: { name: "asc" }, take: 50 });
  // SEL-011: a domain is shown only for a VERIFIED seller that points at a verified claim.
  const verified = s.status === "VERIFIED" && !!s.verifiedClaimId && !!s.verifiedDomain;
  return {
    id: s.id, slug: s.slug, name: s.name, description: s.description, websiteUrl: s.websiteUrl,
    status: s.status, verifiedDomain: verified ? s.verifiedDomain : null, products,
  };
}

export async function listMySellers(db: Pick<Db, "sellerMember">, actor: Actor) {
  const rows = await db.sellerMember.findMany({ where: { userId: actor.id }, select: { role: true, seller: { select: { id: true, name: true, slug: true, status: true, closedAt: true } } }, orderBy: { createdAt: "asc" }, take: 100 });
  return rows.filter((r) => !r.seller.closedAt).map((r) => ({ ...r.seller, role: r.role as SellerMemberRole }));
}

const CLAIM_VIEW = {
  id: true, scope: true, method: true, status: true, domain: true, challengeExpiresAt: true, requiresHumanReview: true,
  lastCheckAt: true, lastCheckOutcome: true, verifiedUntil: true, createdAt: true,
} as const;

/** Claims of one seller for its OWNER/MANAGER. Challenge values are never returned here: instructions are shown once at submit. */
export async function listSellerClaims(db: Pick<Db, "user" | "sellerMember" | "enforcementAction" | "sellerOwnershipClaim">, actor: Actor, sellerId: string) {
  await requireSellerPermission(db, actor, "seller.claim.submit", sellerId);
  return db.sellerOwnershipClaim.findMany({ where: { sellerId }, select: CLAIM_VIEW, orderBy: { createdAt: "desc" }, take: 20 });
}

export async function getSellerDashboard(db: Db, actor: Actor, sellerId: string) {
  const seller = await db.seller.findUnique({ where: { id: sellerId }, select: { id: true, slug: true, name: true, status: true, verifiedDomain: true, verifiedAt: true, closedAt: true } });
  const me = await db.sellerMember.findUnique({ where: { sellerId_userId: { sellerId, userId: actor.id } }, select: { role: true } });
  const staff = actor.role === "admin" || actor.role === "super_admin";
  if (!seller || seller.closedAt || (!me && !staff)) return null; // non-members cannot tell whether the seller exists
  const role = (me?.role as SellerMemberRole | undefined) ?? null;
  const canManage = role === "OWNER" || role === "MANAGER";
  const [members, invitations, claims] = await Promise.all([
    db.sellerMember.findMany({ where: { sellerId }, select: { userId: true, role: true, user: { select: { handle: true, displayName: true } } }, orderBy: { createdAt: "asc" }, take: 200 }),
    canManage ? db.sellerInvitation.findMany({ where: { sellerId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, email: true, role: true, expiresAt: true }, orderBy: { createdAt: "desc" }, take: 100 }) : Promise.resolve([]),
    canManage ? db.sellerOwnershipClaim.findMany({ where: { sellerId }, select: CLAIM_VIEW, orderBy: { createdAt: "desc" }, take: 20 }) : Promise.resolve([]),
  ]);
  return {
    seller, role, canManage, canRemove: role === "OWNER", selfId: actor.id, invitations, claims,
    members: members.map((m) => ({ userId: m.userId, role: m.role as SellerMemberRole, handle: m.user.handle, displayName: m.user.displayName })),
  };
}

/** Banner state comes from the database, not the JWT (same rule as requireVerifiedUser). */
export async function isEmailUnverified(db: Pick<Db, "user">, userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } });
  return !!u && !u.emailVerifiedAt;
}
