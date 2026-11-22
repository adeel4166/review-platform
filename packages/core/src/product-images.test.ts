import { describe, expect, it } from "vitest";
import { PRODUCT_IMAGE_ALT_MAX, buildGallery, cloudinaryDeliveryUrl, pickPrimary, planReorder, productImagePublicId, productImageUrl, splitCloudinaryKey, validateAltText, type ProductImageRow } from "./index";

const row = (o: Partial<ProductImageRow>): ProductImageRow => ({ id: "i", productId: "p", publicId: "m/a/medium", format: "webp", width: 1024, height: 768, alt: "alt", position: 0, isPrimary: false, publishedAt: new Date(1), createdAt: new Date(1), ...o });
const r = { publicBaseUrl: "https://cdn.example/" };

describe("alt text (required plain text)", () => {
  it("accepts plain text and normalises whitespace", () => expect(validateAltText("  Red   kettle,\nfront view ")).toEqual({ ok: true, alt: "Red kettle, front view" }));
  it.each([["", "empty"], ["   ", "empty"], ["see https://evil.example", "link"], ["a@b.com", "email"], ["<b>x</b>", "markup"], ["x".repeat(PRODUCT_IMAGE_ALT_MAX + 1), "too_long"]])("rejects %j as %s", (v, reason) => {
    expect(validateAltText(v)).toEqual({ ok: false, reason });
  });
});

describe("URL derivation (never stored)", () => {
  it("public id equals the Cloudinary public_id of the medium variant", () => {
    expect(productImagePublicId("abc")).toBe("m/abc/medium");
    expect(splitCloudinaryKey(`${productImagePublicId("abc")}.webp`).publicId).toBe("m/abc/medium");
  });
  it("S3/MinIO/CDN mode uses the base URL", () => expect(productImageUrl("m/a/medium", "webp", r)).toBe("https://cdn.example/m/a/medium.webp"));
  it("Cloudinary mode uses the delivery URL for the same value (no data migration when switching)", () => {
    const u = productImageUrl("m/a/medium", "webp", { publicUrlFor: (k) => cloudinaryDeliveryUrl("demo", k) });
    expect(u).toBe("https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/m/a/medium.webp");
  });
  it("placeholder ids are served from the web app whatever the store", () => expect(productImageUrl("placeholder/books-1", "svg", r)).toBe("/placeholders/books-1.svg"));
});

describe("gallery and primary selection", () => {
  const rows = [
    row({ id: "c", position: 2, publicId: "m/c/medium" }),
    row({ id: "a", position: 0, publicId: "m/a/medium" }),
    row({ id: "u", position: 1, publishedAt: null }), // unpublished: never public
    row({ id: "b", position: 1, publicId: "m/b/medium", isPrimary: true }),
  ];
  it("lists published images only, ordered by position, with url/width/height/alt", () => {
    const g = buildGallery(rows, r);
    expect(g.map((x) => x.url)).toEqual(["https://cdn.example/m/a/medium.webp", "https://cdn.example/m/b/medium.webp", "https://cdn.example/m/c/medium.webp"]);
    expect(g[0]).toEqual({ url: expect.any(String), width: 1024, height: 768, alt: "alt" });
  });
  it("primary = published isPrimary image", () => expect(pickPrimary(rows, r)?.url).toContain("m/b/"));
  it("an unpublished primary falls back to the lowest-position published image", () => {
    expect(pickPrimary([row({ id: "x", isPrimary: true, publishedAt: null }), row({ id: "y", position: 3, publicId: "m/y/medium" })], r)?.url).toContain("m/y/");
  });
  it("no published image -> null (placeholder)", () => expect(pickPrimary([row({ publishedAt: null })], r)).toBeNull());
});

describe("planReorder", () => {
  it("renumbers 0..n-1", () => expect([...planReorder(["a", "b", "c"], ["c", "a", "b"])!]).toEqual([["c", 0], ["a", 1], ["b", 2]]));
  it.each([[["a", "b"]], [["a", "a", "b"]], [["a", "b", "x"]]])("rejects %j", (req) => expect(planReorder(["a", "b", "c"], req)).toBeNull());
});
