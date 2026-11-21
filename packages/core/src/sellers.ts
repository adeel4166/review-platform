/** Pure seller rules (M3 spec §4). No I/O: the web services load the facts and call these. */

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // SEL-007
export const SELLERS_PER_USER_PER_DAY = 3;
export const OPEN_INVITATIONS_PER_SELLER = 20;
export const INVITATIONS_PER_SELLER_PER_DAY = 10;

export type SellerStatus = "UNVERIFIED" | "PENDING_VERIFICATION" | "VERIFIED" | "SUSPENDED" | "CLOSED";
export type SellerMemberRole = "OWNER" | "MANAGER" | "RESPONDER";

// A small, explicit confusable map (Cyrillic/Greek lookalikes and digit/letter swaps). A full UTS #39 table is a later hardening.
const CONFUSABLE: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", ԁ: "d", ӏ: "l",
  α: "a", ο: "o", ρ: "p", ν: "v", ι: "i", κ: "k", τ: "t", υ: "u", ε: "e",
  "0": "o", "1": "l", "5": "s", "3": "e", "|": "l",
};

/** Casefolded, diacritic-free, confusable-folded name with whitespace and punctuation removed (SEL-010). */
export function sellerNameSkeleton(name: string): string {
  const base = name.normalize("NFKC").toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "");
  let out = "";
  for (const ch of base) {
    const c = CONFUSABLE[ch] ?? ch;
    if (/[\p{L}\p{N}]/u.test(c)) out += c;
  }
  return out.slice(0, 120);
}

/** True when two strings are within Damerau-Levenshtein (optimal string alignment) distance 1. */
export function withinEditDistanceOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // transposition
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.slice(i) === l.slice(i + 1); // insertion / deletion
}

/** SEL-010: similar to (or equal to) the skeleton of an existing VERIFIED seller. */
export const isSimilarToVerified = (skeleton: string, verifiedSkeletons: readonly string[]): boolean =>
  skeleton.length > 0 && verifiedSkeletons.some((v) => withinEditDistanceOne(skeleton, v));

export function slugify(name: string): string {
  const s = name.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "");
  return s;
}

export interface SellerFacts {
  closedAt: Date | null;
  suspended: boolean; // an ACTIVE SELLER_SUSPENSION in its window
  hasVerifiedSellerClaim: boolean; // a VERIFIED, SELLER-scope claim of THIS seller
  hasOpenSellerClaim: boolean; // PENDING or CONTESTED, SELLER-scope
}

/** SEL-011: VERIFIED is only reachable through a verified SELLER-scope claim. */
export function computeSellerStatus(f: SellerFacts): SellerStatus {
  if (f.closedAt) return "CLOSED";
  if (f.suspended) return "SUSPENDED";
  if (f.hasVerifiedSellerClaim) return "VERIFIED";
  if (f.hasOpenSellerClaim) return "PENDING_VERIFICATION";
  return "UNVERIFIED";
}

// ---------------------------------------------------------------------------------------------------------------
// Seller-scope authorization (AZ-007, AZ-010). The seller id is ALWAYS taken from the loaded resource, never from input.
// ---------------------------------------------------------------------------------------------------------------

export const SELLER_PERMISSIONS = [
  "seller.profile.update",
  "seller.member.invite",
  "seller.member.manage",
  "seller.claim.submit",
  "seller.claim.review",
  "product.update",
] as const;
export type SellerPermission = (typeof SELLER_PERMISSIONS)[number];

/** Role grants per permission. `seller.claim.review` is staff-only and is never granted by membership. */
const ROLE_GRANTS: Record<SellerPermission, readonly SellerMemberRole[]> = {
  "seller.profile.update": ["OWNER", "MANAGER"],
  "seller.member.invite": ["OWNER", "MANAGER"],
  "seller.member.manage": ["OWNER"],
  "seller.claim.submit": ["OWNER", "MANAGER"],
  "seller.claim.review": [],
  "product.update": ["OWNER", "MANAGER"],
};

export type DenyCode = "ACCOUNT_INACTIVE" | "SELLER_SUSPENDED" | "NOT_IN_SCOPE" | "FORBIDDEN_ROLE" | "CONFLICT_OF_INTEREST";
export type AuthzResult = { allowed: true } | { allowed: false; code: DenyCode };

export interface SellerAuthzContext {
  accountActive: boolean;
  /** Platform staff tier of the actor (not seller membership). */
  staffTier: "none" | "moderator" | "admin";
  /** The actor's role in THE RESOURCE'S seller, or null when not a member of it. */
  memberRole: SellerMemberRole | null;
  /** An active SELLER_SUSPENSION exists for THE RESOURCE'S seller. */
  sellerSuspended: boolean;
  /** Actor belongs to the other (conflicting) seller of a contested claim. */
  memberOfConflictingSeller?: boolean;
}

/**
 * Guard order (ADR-0003 §3): account state, then suspension of this seller (removes every seller permission of every
 * member, AZ-007), then role in THIS seller (AZ-010), then conditions. `seller.claim.review` is for ADMIN-tier staff and
 * is denied to members of the claiming and of the conflicting seller (conflict of interest).
 */
export function authorizeSeller(ctx: SellerAuthzContext, perm: SellerPermission): AuthzResult {
  if (!ctx.accountActive) return { allowed: false, code: "ACCOUNT_INACTIVE" };
  if (perm === "seller.claim.review") {
    if (ctx.staffTier !== "admin") return { allowed: false, code: "FORBIDDEN_ROLE" };
    if (ctx.memberRole !== null || ctx.memberOfConflictingSeller) return { allowed: false, code: "CONFLICT_OF_INTEREST" };
    return { allowed: true };
  }
  if (ctx.sellerSuspended) return { allowed: false, code: "SELLER_SUSPENDED" };
  if (ctx.memberRole === null) return { allowed: false, code: "NOT_IN_SCOPE" };
  if (!ROLE_GRANTS[perm].includes(ctx.memberRole)) return { allowed: false, code: "FORBIDDEN_ROLE" };
  return { allowed: true };
}

/** Roles a given inviter may grant. No invitation ever grants OWNER in M3a (ADR-0017). */
export function canInviteRole(inviter: SellerMemberRole, target: SellerMemberRole): boolean {
  if (target === "OWNER") return false;
  if (inviter === "OWNER") return target === "MANAGER" || target === "RESPONDER";
  if (inviter === "MANAGER") return target === "RESPONDER";
  return false;
}
