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
    expect(validateImage(img, LIMITS.mediaMax)).toMatch(/at most 10/);
  });
});

describe("errorKeyFor", () => {
  it("maps API error codes to messages", () => {
    expect(errorKeyFor("already_reviewed")).toBe("form.error.already_reviewed");
    expect(errorKeyFor("unauthenticated")).toBe("form.error.unauthenticated");
    expect(errorKeyFor("boom")).toBe("form.error.generic");
  });
});

import { rejectionKey, uploadErrorKey, validateMedia } from "./review-form";

describe("validateMedia (photos and videos)", () => {
  const none = { photos: 0, videos: 0 };
  const mp4 = { name: "clip.mp4", type: "video/mp4", size: 5_000_000 };
  it("accepts a video within limits and a photo", () => {
    expect(validateMedia(mp4, none, 12)).toBeNull();
    expect(validateMedia({ name: "a.png", type: "image/png", size: 10 }, none)).toBeNull();
  });
  it("rejects wrong type, oversize/long video and the third video, with the file name", () => {
    expect(validateMedia({ name: "a.gif", type: "image/gif", size: 10 }, none)).toMatch(/a\.gif is not a supported type/);
    expect(validateMedia({ ...mp4, size: LIMITS.videoMaxBytes + 1 }, none)).toMatch(/clip\.mp4 is larger than 50 MB/);
    expect(validateMedia(mp4, none, 31)).toMatch(/longer than 30 seconds/);
    expect(validateMedia(mp4, { photos: 0, videos: 2 }, 5)).toMatch(/at most 2 videos/);
  });
  it("maps API and rejection codes to plain-language messages", () => {
    expect(uploadErrorKey("upload_quota")).toBe("form.media.err.upload_quota");
    expect(uploadErrorKey("something")).toBe("form.media.err.generic");
    expect(rejectionKey("MALWARE")).toBe("media.rejected.unsafe");
    expect(rejectionKey("TOO_LONG")).toBe("media.rejected.long");
    expect(rejectionKey(null)).toBe("media.rejected.generic");
  });
});
