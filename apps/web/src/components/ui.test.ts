import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewForm } from "./ReviewForm";
import { ReviewCard } from "./ReviewCard";
import { Pagination } from "./Pagination";

describe("ReviewForm (SSR markup)", () => {
  const html = renderToStaticMarkup(createElement(ReviewForm, { productId: "p1", productName: "Phone", productHref: "/products/phone" }));
  it("labels every field and groups the rating", () => {
    expect(html).toMatch(/<label for="title"/);
    expect(html).toMatch(/<label for="body"/);
    expect(html).toMatch(/<legend[^>]*>Overall rating/);
    expect((html.match(/type="radio"/g) ?? []).length).toBe(5);
  });
  it("accepts only allowed image types and has a submit button", () => {
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toMatch(/<button type="submit"[^>]*>Submit review/);
  });
});

describe("ReviewCard", () => {
  const r = { id: "r1", rating: 5, title: "Nice", body: "Body text here", verifiedBuyer: true, publishedAt: "2026-01-02T00:00:00Z",
    author: { handle: "a", displayName: "Alice" }, media: [{ id: "m1", width: 1, height: 1, thumbUrl: "https://x/t", mediumUrl: "https://x/m" }] };
  it("shows Verified buyer badge, alt text and star text", () => {
    const html = renderToStaticMarkup(createElement(ReviewCard, { review: r }));
    expect(html).toContain("Verified buyer");
    expect(html).toMatch(/alt="Photo 1 of review &quot;Nice&quot;"/);
    expect(html).toContain("Rated 5 out of 5");
  });
  it("omits the badge for non-verified reviews", () => {
    expect(renderToStaticMarkup(createElement(ReviewCard, { review: { ...r, verifiedBuyer: false } }))).not.toContain("Verified buyer");
  });
});

describe("Pagination", () => {
  it("renders nothing for a single page and marks the current page", () => {
    expect(renderToStaticMarkup(createElement(Pagination, { page: 1, pages: 1, href: (p: number) => `?p=${p}` }))).toBe("");
    expect(renderToStaticMarkup(createElement(Pagination, { page: 2, pages: 3, href: (p: number) => `?p=${p}` }))).toContain('aria-current="page"');
  });
});
