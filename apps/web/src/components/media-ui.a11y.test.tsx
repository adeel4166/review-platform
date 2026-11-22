// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, it } from "vitest";
import { ReviewCard, type PublicReview } from "./ReviewCard";
import { MediaStatusList, mediaStateText } from "./MediaStatusList";
import { MediaQueue, mediaAdminErrorKey, reasonText } from "./admin/MediaQueue";
import { ApiError } from "@/lib/upload";

expect.extend(toHaveNoViolations);
async function check(el: ReactElement) {
  document.body.innerHTML = `<main><h1>Page</h1><h2>Reviews</h2>${renderToStaticMarkup(el)}</main>`;
  return axe(document.body);
}
const review: PublicReview = {
  id: "r1", rating: 4, title: "Solid", body: "A solid product overall.", publishedAt: "2026-01-02T00:00:00Z", author: { handle: "a", displayName: "Alice" },
  media: [
    { id: "p1", width: 800, height: 600, thumbUrl: "https://cdn/m/p1/thumb.webp", mediumUrl: "https://cdn/m/p1/medium.webp" },
    { id: "v1", kind: "VIDEO", width: 720, height: 1280, thumbUrl: "https://cdn/m/v1/thumb.webp", mediumUrl: "https://cdn/m/v1/medium.webp", videoUrl: "https://cdn/m/v1/video.mp4", posterUrl: "https://cdn/m/v1/poster.webp" },
  ],
};

describe("media display", () => {
  it("renders lazy responsive photos with alt text and an accessible, non-autoplay video", async () => {
    const html = renderToStaticMarkup(createElement(ReviewCard, { review }));
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("256w");
    expect(html).toContain('alt="Photo 1 of review &quot;Solid&quot;"');
    expect(html).toContain("<video");
    expect(html).toContain('controls=""');
    expect(html).toContain('type="video/mp4"');
    expect(html).not.toContain("autoplay");
    expect(html).toContain('preload="none"');
    expect(await check(createElement(ReviewCard, { review }))).toHaveNoViolations();
  });
});

describe("processing states", () => {
  it("maps statuses to text (never colour alone), with a reason and next step for rejected files", () => {
    expect(mediaStateText({ status: "PROCESSING", failureReason: null }).text).toMatch(/Checking/);
    expect(mediaStateText({ status: "READY", failureReason: null }).tone).toBe("ok");
    const r = mediaStateText({ status: "FAILED", failureReason: "MALWARE" });
    expect(r.tone).toBe("error");
    expect(r.text).toMatch(/Not accepted: .*safety check.*different file/);
    expect(r.text).not.toMatch(/eicar|virus signature/i);
  });
  it("renders the owner's list accessibly", async () => {
    const el = createElement(MediaStatusList, { reviewId: "r1", initial: [
      { id: "a", status: "PROCESSING", failureReason: null, kind: "IMAGE" },
      { id: "b", status: "FAILED", failureReason: "MALWARE", kind: "IMAGE" },
      { id: "c", status: "READY", failureReason: null, kind: "VIDEO" },
    ] });
    expect(await check(el)).toHaveNoViolations();
    expect(renderToStaticMarkup(el)).toContain("Video 1");
  });
});

describe("admin media queue", () => {
  it("has an accessible initial state and maps errors/reasons", async () => {
    expect(await check(createElement(MediaQueue))).toHaveNoViolations();
    expect(mediaAdminErrorKey(new ApiError(409, "not_retryable"))).toBe("admin.media.err.state");
    expect(mediaAdminErrorKey(new Error("x"))).toBe("admin.media.err.generic");
    expect(reasonText("MALWARE")).toBe("Malware detected");
  });
});
