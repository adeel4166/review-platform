import { describe, expect, it } from "vitest";
import { CompareError, buildComparison, parseCompareIds, type CompareProductRow } from "./compare";
import { authorizeFollow, handleChangeAllowed, profileVisible, publicProfile } from "./social";

const row = (id: string, o: Partial<CompareProductRow> = {}): CompareProductRow => ({ id, slug: id, name: id, status: "ACTIVE", mergedIntoId: null, categoryId: "c1", ratingAverage: 4.2, ratingCount: 100, verifiedRatingAverage: 4.5, verifiedRatingCount: 40, ratingHistogram: { "5": 60, "4": 20, "3": 10, "2": 5, "1": 5 }, specs: { battery_wh: 50, weight_g: 900 }, sellerBand: "HIGH", ...o });

describe("TRS-006 comparison", () => {
  it("accepts 2-4 distinct ids only", () => {
    expect(() => parseCompareIds("a")).toThrow(CompareError);
    expect(() => parseCompareIds("a,b,c,d,e")).toThrow(CompareError);
    expect(() => parseCompareIds("a,a")).toThrow(expect.objectContaining({ code: "compare_duplicate" }));
    expect(parseCompareIds("a,b,c")).toEqual(["a", "b", "c"]);
  });
  it("resolves MERGED, marks ARCHIVED/REMOVED unavailable, flags low sample and best specs, warns on category mix", () => {
    const rows = new Map([
      ["a", row("a")], ["b", row("b", { ratingCount: 10, specs: { battery_wh: 70, weight_g: 1200 }, categoryId: "c2" })],
      ["m", row("m", { status: "MERGED", mergedIntoId: "a" })], ["x", row("x", { status: "ARCHIVED" })],
    ]);
    const r = buildComparison(["a", "b", "x"], rows);
    expect(r.items[2]).toEqual({ id: "x", unavailable: true });
    const [a, b] = r.items as Exclude<(typeof r.items)[number], { unavailable: true }>[];
    expect(a!.lowSample).toBe(false); expect(b!.lowSample).toBe(true);
    expect(a!.best).toEqual(["weight_g"]); expect(b!.best).toEqual(["battery_wh"]);
    expect(a!.histogramPct["5"]).toBe(60); expect(r.categoriesDiffer).toBe(true);
    expect((buildComparison(["m", "b"], rows).items[0] as { mergedFrom?: string }).mergedFrom).toBe("m");
  });
});

describe("FOL-001 / PRF-001 / AZ-014", () => {
  const base = { actorId: "u1", targetType: "USER" as const, targetId: "u2", targetExists: true, targetBlockedActor: false };
  it("self-follow, blocked and missing targets are refused", () => {
    expect(authorizeFollow(base)).toEqual({ ok: true });
    expect(authorizeFollow({ ...base, targetId: "u1" })).toEqual({ ok: false, deny: "SELF_FOLLOW" });
    expect(authorizeFollow({ ...base, targetBlockedActor: true })).toEqual({ ok: false, deny: "BLOCKED" });
    expect(authorizeFollow({ ...base, targetExists: false })).toEqual({ ok: false, deny: "NOT_FOUND" });
    expect(authorizeFollow({ ...base, targetType: "PRODUCT", targetId: "u1" })).toEqual({ ok: true });
  });
  it("public profile DTO has no private fields; non-active or blocking users are hidden", () => {
    const dto = publicProfile({ handle: "h", displayName: "H", bio: null, trustBand: "MEDIUM", createdAt: new Date("2025-05-05"), status: "ACTIVE", ...{ email: "x@y.z", ipHash: "abc", trustScore: 77 } } as never, { reviews: 1, helpfulReceived: 2, followers: 3, following: 4 });
    expect(JSON.stringify(dto)).not.toMatch(/email|ipHash|trustScore|status|77/);
    expect(dto).toMatchObject({ band: "MEDIUM", memberSinceYear: 2025 });
    for (const s of ["SUSPENDED", "BANNED", "DELETED"]) expect(profileVisible(s, false)).toBe(false);
    expect(profileVisible("ACTIVE", true)).toBe(false); expect(profileVisible("ACTIVE", false)).toBe(true);
  });
  it("handle changes once per 30 days", () => {
    const now = new Date("2027-03-01T00:00:00Z");
    expect(handleChangeAllowed(null, now)).toBe(true);
    expect(handleChangeAllowed(new Date("2027-02-10T00:00:00Z"), now)).toBe(false);
    expect(handleChangeAllowed(new Date("2027-01-30T00:00:00Z"), now)).toBe(true);
  });
});
