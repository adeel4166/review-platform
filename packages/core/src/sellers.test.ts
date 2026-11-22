import { describe, expect, it } from "vitest";
import {
  INVITATION_TTL_MS, SELLER_PERMISSIONS, authorizeSeller, canInviteRole, computeSellerStatus, isSimilarToVerified,
  sellerNameSkeleton, slugify, withinEditDistanceOne, type SellerAuthzContext, type SellerMemberRole, type SellerPermission,
} from "./sellers";

const base: SellerAuthzContext = { accountActive: true, staffTier: "none", memberRole: null, sellerSuspended: false, twoFactor: { enrolled: true, sessionVerified: true }, sellerVerified: true, replyRestricted: false };

describe("authorizeSeller (AZ-007, AZ-010): every permission x every role", () => {
  const ROLES: SellerMemberRole[] = ["OWNER", "MANAGER", "RESPONDER"];
  const expected: Record<SellerPermission, SellerMemberRole[]> = {
    "seller.profile.update": ["OWNER", "MANAGER"],
    "seller.member.invite": ["OWNER", "MANAGER"],
    "seller.member.manage": ["OWNER"],
    "product.image.manage": ["OWNER", "MANAGER"],
    "seller.claim.submit": ["OWNER", "MANAGER"],
    "seller.claim.review": [],
    "product.update": ["OWNER", "MANAGER"],
    "seller.reply": ["OWNER", "MANAGER", "RESPONDER"],
    "seller.reply.manage": ["OWNER", "MANAGER", "RESPONDER"],
  };
  it("covers every permission in the table", () => expect(Object.keys(expected).sort()).toEqual([...SELLER_PERMISSIONS].sort()));

  for (const perm of SELLER_PERMISSIONS) {
    for (const role of ROLES) {
      it(`${perm} as ${role} in the resource's seller`, () => {
        expect(authorizeSeller({ ...base, memberRole: role }, perm).allowed).toBe(expected[perm].includes(role));
      });
      it(`${perm} as ${role} of ANOTHER seller (not a member of the resource's seller) is NOT_IN_SCOPE`, () => {
        // The caller loads the role for the RESOURCE's seller; a role held elsewhere is null here.
        const r = authorizeSeller({ ...base, memberRole: null }, perm);
        expect(r).toEqual(perm === "seller.claim.review" ? { allowed: false, code: "FORBIDDEN_ROLE" } : { allowed: false, code: "NOT_IN_SCOPE" });
      });
      it(`${perm} as ${role}: an active SELLER_SUSPENSION removes it (AZ-007)`, () => {
        const r = authorizeSeller({ ...base, memberRole: role, sellerSuspended: true }, perm);
        expect(r.allowed).toBe(false);
        if (perm !== "seller.claim.review") expect(r).toEqual({ allowed: false, code: "SELLER_SUSPENDED" });
      });
    }
    it(`${perm}: inactive accounts are denied`, () => {
      expect(authorizeSeller({ ...base, accountActive: false, memberRole: "OWNER", staffTier: "admin" }, perm)).toEqual({ allowed: false, code: "ACCOUNT_INACTIVE" });
    });
  }

  it("seller.claim.review: ADMIN non-member allowed; members of either seller denied (COI); moderators denied", () => {
    expect(authorizeSeller({ ...base, staffTier: "admin" }, "seller.claim.review").allowed).toBe(true);
    expect(authorizeSeller({ ...base, staffTier: "admin", memberRole: "OWNER" }, "seller.claim.review")).toEqual({ allowed: false, code: "CONFLICT_OF_INTEREST" });
    expect(authorizeSeller({ ...base, staffTier: "admin", memberOfConflictingSeller: true }, "seller.claim.review")).toEqual({ allowed: false, code: "CONFLICT_OF_INTEREST" });
    expect(authorizeSeller({ ...base, staffTier: "moderator" }, "seller.claim.review").allowed).toBe(false);
  });
});

describe("authorizeSeller: reply gates (m3b-spec 5.4 steps 7-9)", () => {
  for (const perm of ["seller.reply", "seller.reply.manage"] as const) {
    it(`${perm}: RESPONDER needs no 2FA, OWNER/MANAGER do`, () => {
      const no2fa = { ...base, twoFactor: { enrolled: false, sessionVerified: false } };
      expect(authorizeSeller({ ...no2fa, memberRole: "RESPONDER" }, perm).allowed).toBe(true);
      for (const r of ["OWNER", "MANAGER"] as const) expect(authorizeSeller({ ...no2fa, memberRole: r }, perm)).toEqual({ allowed: false, code: "TWO_FACTOR_REQUIRED" });
    });
    it(`${perm}: unverified seller is SELLER_NOT_VERIFIED, restriction is REPLY_RESTRICTED, missing facts fail closed`, () => {
      expect(authorizeSeller({ ...base, memberRole: "RESPONDER", sellerVerified: false }, perm)).toEqual({ allowed: false, code: "SELLER_NOT_VERIFIED" });
      expect(authorizeSeller({ ...base, memberRole: "RESPONDER", replyRestricted: true }, perm)).toEqual({ allowed: false, code: "REPLY_RESTRICTED" });
      expect(authorizeSeller({ ...base, memberRole: "RESPONDER", sellerVerified: undefined }, perm).allowed).toBe(false);
      expect(authorizeSeller({ ...base, memberRole: "RESPONDER", replyRestricted: undefined }, perm).allowed).toBe(false);
    });
    it(`${perm}: suspension wins over the reply gates; non-members stay NOT_IN_SCOPE`, () => {
      expect(authorizeSeller({ ...base, memberRole: "OWNER", sellerSuspended: true, sellerVerified: false }, perm)).toEqual({ allowed: false, code: "SELLER_SUSPENDED" });
      expect(authorizeSeller({ ...base, memberRole: null, sellerVerified: false }, perm)).toEqual({ allowed: false, code: "NOT_IN_SCOPE" });
    });
  }
});

describe("canInviteRole", () => {
  it("never grants OWNER; MANAGER only invites RESPONDER; RESPONDER invites nobody", () => {
    expect(canInviteRole("OWNER", "OWNER")).toBe(false);
    expect(canInviteRole("OWNER", "MANAGER")).toBe(true);
    expect(canInviteRole("OWNER", "RESPONDER")).toBe(true);
    expect(canInviteRole("MANAGER", "MANAGER")).toBe(false);
    expect(canInviteRole("MANAGER", "RESPONDER")).toBe(true);
    expect(canInviteRole("RESPONDER", "RESPONDER")).toBe(false);
  });
  it("invitation TTL is 7 days (SEL-007)", () => expect(INVITATION_TTL_MS).toBe(7 * 24 * 3600 * 1000));
});

describe("computeSellerStatus (SEL-011)", () => {
  const f = { closedAt: null, suspended: false, hasVerifiedSellerClaim: false, hasOpenSellerClaim: false };
  it("is VERIFIED only with a verified SELLER-scope claim", () => {
    expect(computeSellerStatus(f)).toBe("UNVERIFIED");
    expect(computeSellerStatus({ ...f, hasOpenSellerClaim: true })).toBe("PENDING_VERIFICATION");
    expect(computeSellerStatus({ ...f, hasVerifiedSellerClaim: true })).toBe("VERIFIED");
  });
  it("suspension and closure win over verification", () => {
    expect(computeSellerStatus({ ...f, hasVerifiedSellerClaim: true, suspended: true })).toBe("SUSPENDED");
    expect(computeSellerStatus({ ...f, hasVerifiedSellerClaim: true, suspended: true, closedAt: new Date() })).toBe("CLOSED");
  });
});

describe("name similarity (SEL-010)", () => {
  it("folds case, punctuation, diacritics and confusables", () => {
    expect(sellerNameSkeleton("Acme, Inc.")).toBe(sellerNameSkeleton("ACME Inc"));
    expect(sellerNameSkeleton("Ácmé")).toBe("acme");
    expect(sellerNameSkeleton("Асme")).toBe("acme"); // Cyrillic А and с
  });
  it("edit distance 1: substitution, insertion, deletion, transposition", () => {
    expect(withinEditDistanceOne("acme", "acne")).toBe(true);
    expect(withinEditDistanceOne("acme", "acmee")).toBe(true);
    expect(withinEditDistanceOne("acme", "ame")).toBe(true);
    expect(withinEditDistanceOne("acme", "amce")).toBe(true);
    expect(withinEditDistanceOne("acme", "axne")).toBe(false);
    expect(withinEditDistanceOne("acme", "acmeco")).toBe(false);
  });
  it("flags names similar to a verified skeleton only", () => {
    expect(isSimilarToVerified("acmestore", ["acmestore"])).toBe(true);
    expect(isSimilarToVerified("acmestor", ["acmestore"])).toBe(true);
    expect(isSimilarToVerified("globex", ["acmestore"])).toBe(false);
    expect(isSimilarToVerified("", [""])).toBe(false);
  });
  it("slugifies", () => expect(slugify("  Café Ünïcode & Co!  ")).toBe("cafe-unicode-co"));
});

describe("AZ-026: 2FA gate for seller OWNER/MANAGER permissions", () => {
  const cases = [{ enrolled: false, sessionVerified: false }, { enrolled: true, sessionVerified: false }, { enrolled: false, sessionVerified: true }];
  it.each(["OWNER", "MANAGER"] as const)("%s needs enrolment AND a verified session", (role) => {
    for (const twoFactor of cases) expect(authorizeSeller({ ...base, memberRole: role, twoFactor }, "seller.profile.update")).toEqual({ allowed: false, code: "TWO_FACTOR_REQUIRED" });
    expect(authorizeSeller({ ...base, memberRole: role }, "seller.profile.update")).toEqual({ allowed: true });
  });
  it("a non-member is NOT_IN_SCOPE before any 2FA check, and a role without the grant stays FORBIDDEN_ROLE", () => {
    expect(authorizeSeller({ ...base, memberRole: null, twoFactor: cases[0]! }, "seller.profile.update")).toEqual({ allowed: false, code: "NOT_IN_SCOPE" });
    expect(authorizeSeller({ ...base, memberRole: "RESPONDER", twoFactor: cases[0]! }, "seller.profile.update")).toEqual({ allowed: false, code: "FORBIDDEN_ROLE" });
  });
});
