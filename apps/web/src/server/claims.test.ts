import { describe, expect, it } from "vitest";
import { createFakeClaimDb } from "@rp/core";
import { decideClaim, mapClaimError } from "./claims";
import { claimDecisionInput, claimSubmitInput } from "./validation";
import { HttpError } from "./http";
import { SelfDecisionError } from "@rp/core";

describe("claim submit schema (SEL-012, AZ-010)", () => {
  const ok = { scope: "SELLER", method: "DNS_TXT", domain: "acme.com" };
  it("accepts a valid SELLER DNS claim", () => expect(claimSubmitInput.parse(ok)).toMatchObject(ok));
  it("PRODUCT scope requires productId and a manual method", () => {
    expect(claimSubmitInput.safeParse({ scope: "PRODUCT", method: "DOCUMENT" }).success).toBe(false);
    expect(claimSubmitInput.safeParse({ scope: "PRODUCT", method: "DNS_TXT", productId: "p1", domain: "acme.com" }).success).toBe(false);
    expect(claimSubmitInput.safeParse({ scope: "PRODUCT", method: "MARKETPLACE", productId: "p1", evidenceUrl: "https://store.example/x" }).success).toBe(true);
    expect(claimSubmitInput.safeParse({ scope: "PRODUCT", method: "DOCUMENT", productId: "p1" }).success).toBe(true);
  });
  it("SELLER scope refuses productId; domain methods need a domain; MARKETPLACE needs an https evidenceUrl; client sellerId is rejected", () => {
    expect(claimSubmitInput.safeParse({ ...ok, productId: "p1" }).success).toBe(false);
    expect(claimSubmitInput.safeParse({ scope: "SELLER", method: "META_TAG" }).success).toBe(false);
    expect(claimSubmitInput.safeParse({ scope: "SELLER", method: "MARKETPLACE" }).success).toBe(false);
    expect(claimSubmitInput.safeParse({ scope: "SELLER", method: "MARKETPLACE", evidenceUrl: "http://x.example/" }).success).toBe(false);
    expect(claimSubmitInput.safeParse({ ...ok, sellerId: "other" }).success).toBe(false);
  });
});

describe("admin decisions", () => {
  const world = () => createFakeClaimDb({
    seller: [{ id: "A", status: "PENDING_VERIFICATION", closedAt: null }],
    sellerMember: [{ sellerId: "A", userId: "owner", role: "OWNER" }],
    sellerOwnershipClaim: [{ id: "c1", sellerId: "A", scope: "SELLER", method: "DOCUMENT", status: "PENDING", requiresHumanReview: true, requiredApprovals: 1, submittedById: "owner", activeKey: "k" }],
  });
  it("only admins decide", async () => {
    await expect(decideClaim(world() as never, { id: "m", role: "user" } as never, "c1", { action: "approve" })).rejects.toMatchObject({ status: 403 });
  });
  it("a staff member who submitted the claim cannot decide it (SelfDecisionError -> 403)", async () => {
    const db = world();
    await expect(decideClaim(db as never, { id: "owner", role: "admin" } as never, "c1", { action: "approve" })).rejects.toMatchObject({ status: 403, code: "self_decision_forbidden" });
    expect(db.t.sellerOwnershipClaim![0]!.status).toBe("PENDING");
    expect(mapClaimError.bind(null, new SelfDecisionError)).toThrow(HttpError);
  });
  it("another admin approves; a claim with a bad state gives 409 invalid_transition; reject needs a reason", async () => {
    const db = world();
    expect(await decideClaim(db as never, { id: "admin", role: "admin" } as never, "c1", { action: "approve" })).toMatchObject({ status: "VERIFIED" });
    await expect(decideClaim(db as never, { id: "admin", role: "admin" } as never, "c1", { action: "approve" })).rejects.toMatchObject({ status: 409, code: "invalid_transition" });
    await expect(decideClaim(world() as never, { id: "admin", role: "admin" } as never, "c1", { action: "reject" })).rejects.toMatchObject({ status: 400 });
    expect(claimDecisionInput.safeParse({ action: "approve", claimId: "x" }).success).toBe(false);
  });
});
