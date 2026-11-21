import { describe, expect, it } from "vitest";
import { getPublicSeller } from "./seller-views";

const fakeDb = (seller: Record<string, unknown> | null) =>
  ({ seller: { findUnique: async () => seller }, product: { findMany: async () => [] } }) as never;
const base = { id: "s1", slug: "acme", name: "Acme", description: null, websiteUrl: null, closedAt: null };

describe("getPublicSeller: the badge is derived from server state only (SEL-009, SEL-011)", () => {
  it("shows the stored punycode domain for a VERIFIED seller with a verified claim", async () => {
    const s = await getPublicSeller(fakeDb({ ...base, status: "VERIFIED", verifiedClaimId: "c1", verifiedDomain: "xn--bcher-kva.example" }), "acme");
    expect(s?.verifiedDomain).toBe("xn--bcher-kva.example");
  });
  it.each([
    ["UNVERIFIED", "c1", "acme.example"],
    ["PENDING_VERIFICATION", "c1", "acme.example"],
    ["SUSPENDED", "c1", "acme.example"],
    ["VERIFIED", null, "acme.example"],
    ["VERIFIED", "c1", null],
  ])("hides the domain for status=%s claim=%s domain=%s", async (status, claim, domain) => {
    const s = await getPublicSeller(fakeDb({ ...base, status, verifiedClaimId: claim, verifiedDomain: domain }), "acme");
    expect(s?.verifiedDomain).toBeNull();
  });
  it("returns null for unknown and closed sellers", async () => {
    expect(await getPublicSeller(fakeDb(null), "x")).toBeNull();
    expect(await getPublicSeller(fakeDb({ ...base, status: "CLOSED", closedAt: new Date(), verifiedClaimId: null, verifiedDomain: null }), "acme")).toBeNull();
  });
});
