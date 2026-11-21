import { describe, expect, it } from "vitest";
import { LIMITS, errorKeyFor, validateImage, validateReview } from "./review-form";

const ok = { rating: 4, title: "Great", body: "Works really well for me." };

describe("validateReview", () => {
  it("accepts a valid draft", () => expect(validateReview(ok)).toEqual({}));
  it("requires a rating 1-5", () => {
    expect(validateReview({ ...ok, rating: 0 }).rating).toBeTruthy();
    expect(validateReview({ ...ok, rating: 6 }).rating).toBeTruthy();
    expect(validateReview({ ...ok, rating: 2.5 }).rating).toBeTruthy();
  });
  it("requires a non-blank title within the limit", () => {
    expect(validateReview({ ...ok, title: "   " }).title).toMatch(/title/i);
    expect(validateReview({ ...ok, title: "x".repeat(LIMITS.titleMax + 1) }).title).toBeTruthy();
    expect(validateReview({ ...ok, title: "x".repeat(LIMITS.titleMax) }).title).toBeUndefined();
  });
  it("enforces body min/max on the trimmed text", () => {
    expect(validateReview({ ...ok, body: "   short   " }).body).toMatch(/at least 10/);
    expect(validateReview({ ...ok, body: "x".repeat(LIMITS.bodyMax + 1) }).body).toBeTruthy();
  });
  it("reports all errors at once", () => {
    expect(Object.keys(validateReview({ rating: 0, title: "", body: "" })).sort()).toEqual(["body", "rating", "title"]);
  });
});

describe("validateImage", () => {
  const img = { name: "a.png", type: "image/png", size: 1000 };
  it("accepts allowed images", () => expect(validateImage(img, 0)).toBeNull());
  it("rejects bad type, empty, oversized and over the cap", () => {
    expect(validateImage({ ...img, type: "image/gif" }, 0)).toMatch(/JPG, PNG or WebP/);
    expect(validateImage({ ...img, size: 0 }, 0)).toMatch(/empty/);
    expect(validateImage({ ...img, size: LIMITS.mediaMaxBytes + 1 }, 0)).toMatch(/10 MB/);
    expect(validateImage(img, LIMITS.mediaMax)).toMatch(/at most 5/);
  });
});

describe("errorKeyFor", () => {
  it("maps API error codes to messages", () => {
    expect(errorKeyFor("already_reviewed")).toBe("form.error.already_reviewed");
    expect(errorKeyFor("unauthenticated")).toBe("form.error.unauthenticated");
    expect(errorKeyFor("boom")).toBe("form.error.generic");
  });
});
