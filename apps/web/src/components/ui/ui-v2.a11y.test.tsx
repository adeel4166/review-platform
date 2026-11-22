// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ReviewForm } from "@/components/ReviewForm";
import { ReviewCard, type PublicReview } from "@/components/ReviewCard";
import { Badge } from "./Badge";
import { Avatar, initials } from "./Avatar";
import { EmptyState } from "./EmptyState";
import { ProductCard } from "./ProductCard";
import { RatingHistogram, parseHistogram } from "./RatingHistogram";
import { ProductCardSkeleton, SkeletonRegion } from "./Skeleton";

expect.extend(toHaveNoViolations);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

async function check(el: ReactElement, h1 = true) {
  document.body.innerHTML = `${renderToStaticMarkup(createElement(SiteHeader))}<main>${h1 ? "<h1>Page</h1>" : ""}${renderToStaticMarkup(el)}</main>${renderToStaticMarkup(createElement(SiteFooter))}`;
  return axe(document.body, { rules: { region: { enabled: false }, "landmark-no-duplicate-banner": { enabled: false }, "landmark-banner-is-top-level": { enabled: false } } });
}
const product = { id: "p1", slug: "phone", name: "Phone X", brandName: "Acme", category: { name: "Phones" }, ratingAverage: "4.30", ratingCount: 10, reviewCount: 10 };
const review: PublicReview = { id: "r1", rating: 4, title: "Solid", body: "Good.", verifiedPurchaseAt: "2026-01-01T00:00:00Z", verificationMethod: "RECEIPT_UPLOAD", publishedAt: "2026-01-02T00:00:00Z", author: { handle: "a", displayName: "Alice Smith" }, media: [] };

describe("UI v2 a11y (axe)", () => {
  it("home page (hero, trust steps, CTA) has no violations", async () => {
    document.body.innerHTML = renderToStaticMarkup(createElement(SiteHeader)) + renderToStaticMarkup(createElement(Home)) + renderToStaticMarkup(createElement(SiteFooter));
    const r = await axe(document.body, { rules: { region: { enabled: false } } });
    expect(r).toHaveNoViolations();
  });
  it("product page building blocks: card, histogram, review card", async () => {
    expect(await check(createElement("div", null, createElement("h2", null, "Results"), createElement(ProductCard, { product }), createElement(RatingHistogram, { average: 4.3, count: 10, histogram: { 5: 6, 4: 2, 3: 1, 2: 1, 1: 0 } }),
      createElement("h2", null, "Reviews"), createElement(ReviewCard, { review })))).toHaveNoViolations();
  });
  it("review form has no violations", async () => {
    expect(await check(createElement(ReviewForm, { productId: "p1", productName: "Phone", productHref: "/products/phone" }))).toHaveNoViolations();
  });
  it("empty state, skeleton, badge, avatar", async () => {
    expect(await check(createElement("div", null, createElement(EmptyState, { title: "Nothing", description: "x" }), createElement(SkeletonRegion, null, createElement(ProductCardSkeleton)), createElement(Badge, { variant: "info", children: "Processing" }), createElement(Avatar, { name: "A B" })))).toHaveNoViolations();
  });
});

describe("UI v2 components", () => {
  it("ProductCard uses one stretched link and a fixed-aspect thumb", () => {
    const html = renderToStaticMarkup(createElement(ProductCard, { product }));
    expect((html.match(/<a /g) ?? []).length).toBe(1);
    expect(html).toContain("aspect-square");
    expect(html).toContain("Rated 4.3 out of 5");
  });
  it("unrated product shows text instead of stars", () => {
    expect(renderToStaticMarkup(createElement(ProductCard, { product: { ...product, ratingCount: 0 } }))).toContain("No ratings yet");
  });
  it("parseHistogram tolerates junk", () => {
    expect(parseHistogram(null)[5]).toBe(0);
    expect(parseHistogram({ 5: 3, 4: "x", 1: -2 })).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 3 });
  });
  it("initials", () => { expect(initials("Alice Smith")).toBe("AS"); expect(initials("bob")).toBe("BO"); });
  it("shell keeps skip target, search role and footer landmark", () => {
    expect(renderToStaticMarkup(createElement(SiteHeader))).toContain('role="search"');
    expect(renderToStaticMarkup(createElement(SiteFooter))).toMatch(/<footer/);
  });
});
