// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { qrMatrix } from "@/lib/qr";
import { TwoFactorSetup } from "./account/TwoFactorSetup";
import { TwoFactorChallenge } from "./account/TwoFactorChallenge";
import { QrCode } from "./QrCode";
import { ReviewCard, type PublicReview } from "./ReviewCard";
import { OwnershipPanel, formatRemaining } from "./seller/OwnershipPanel";
import { SellerReplyBox, validateReply } from "./seller/SellerReplyBox";
import { TokenAction } from "./seller/TokenAction";
import { TransferResponse } from "./seller/TransferResponse";
import { QueueList } from "./admin/QueueList";
import { defaultFilters, queueQueryString, type QueueItem } from "@/lib/moderation-admin";

expect.extend(toHaveNoViolations);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

async function check(el: ReactElement) {
  document.body.innerHTML = `<main><h1>Page</h1><h2>Section</h2>${renderToStaticMarkup(el)}</main>`;
  return axe(document.body);
}

describe("QR encoder", () => {
  const uri = "otpauth://totp/Review%20Platform:e2e@example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Review%20Platform";
  const m = qrMatrix(uri);
  it("has the right size and three finder patterns", () => {
    expect((m.length - 17) % 4).toBe(0);
    const n = m.length;
    for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]] as const) {
      expect(m[y]![x]).toBe(true); expect(m[y + 3]![x + 3]).toBe(true); expect(m[y + 1]![x + 1]).toBe(false);
    }
    expect(m[n - 8]![8]).toBe(true); // dark module
  });
  it("is deterministic and rejects oversize input", () => {
    expect(qrMatrix(uri)).toEqual(m);
    expect(() => qrMatrix("x".repeat(300))).toThrow();
  });
});

describe("helpers", () => {
  it("formatRemaining", () => {
    expect(formatRemaining(72 * 3_600_000)).toBe("3d 0h 0m");
    expect(formatRemaining(5 * 3_600_000 + 7 * 60_000)).toBe("5h 7m");
    expect(formatRemaining(-5)).toBe("0m");
  });
  it("validateReply", () => {
    expect(validateReply("  ")).toBe("reply.err.short");
    expect(validateReply("x".repeat(1501))).toBe("reply.err.long");
    expect(validateReply("Thanks for the feedback.")).toBeNull();
  });
  it("queue query carries the subject type", () => {
    expect(queueQueryString({ ...defaultFilters, subjectType: "SELLER_REPLY" })).toContain("subjectType=SELLER_REPLY");
  });
});

const review: PublicReview = { id: "r1", rating: 4, title: "Good", body: "Works well", publishedAt: "2026-01-01T00:00:00Z", author: { handle: "a", displayName: "Alex" }, media: [], reply: { body: "Thanks!", seller: { name: "Acme", slug: "acme" }, publishedAt: null, editedAt: null } };
const replyItem: QueueItem = { id: "c1", state: "NEEDS_HUMAN", aiScore: 0.5, aiConfidence: 0.5, aiReasons: [], aiProvider: "mock", decisionReason: null, createdAt: "2026-01-01", subjectType: "SELLER_REPLY", review: null, sellerReply: { id: "p1", sellerId: "s", reviewId: "r1", body: "Our reply text", version: 1 } };

describe("M3b UI accessibility (jest-axe)", () => {
  it("2FA setup (intro, already enabled with banner)", async () => {
    expect(await check(createElement(TwoFactorSetup, { initiallyEnabled: false, roleBanner: true }))).toHaveNoViolations();
    expect(await check(createElement(TwoFactorSetup, { initiallyEnabled: true, roleBanner: false }))).toHaveNoViolations();
  });
  it("QR code has a text alternative", async () => {
    expect(await check(createElement(QrCode, { text: "otpauth://totp/x?secret=ABC", alt: "QR" }))).toHaveNoViolations();
  });
  it("2FA challenge", async () => {
    expect(await check(createElement(TwoFactorChallenge, { callbackUrl: "/" }))).toHaveNoViolations();
  });
  it("ownership panel, transfer response and token pages", async () => {
    const members = [{ userId: "u1", role: "OWNER" as const, handle: "o", displayName: "Olly" }, { userId: "u2", role: "MANAGER" as const, handle: "m", displayName: "Mo" }];
    expect(await check(createElement(OwnershipPanel, { sellerId: "s", selfId: "u1", members }))).toHaveNoViolations();
    expect(await check(createElement(TransferResponse, { id: "t1" }))).toHaveNoViolations();
    expect(await check(createElement(TokenAction, { urlToken: "x", endpoint: "/api/x", denyEndpoint: "/api/y", signInHref: "/login", labels: { confirm: "claimemail.confirm", deny: "claimemail.deny", done: "claimemail.done", denied: "claimemail.denied", invalid: "claimemail.invalid" } }))).toHaveNoViolations();
  });
  it("reply composer states and public reply", async () => {
    expect(await check(createElement(SellerReplyBox, { reviewId: "r1", reviewer: "Alex", sellerName: "Acme", initial: null }))).toHaveNoViolations();
    const pending = createElement(SellerReplyBox, { reviewId: "r1", reviewer: "Alex", sellerName: "Acme", initial: { id: "p", status: "PENDING", body: "Thanks" } });
    expect(renderToStaticMarkup(pending)).toContain("Pending moderation");
    expect(await check(pending)).toHaveNoViolations();
    const card = createElement(ReviewCard, { review });
    expect(renderToStaticMarkup(card)).toContain("Reply from Acme");
    expect(await check(card)).toHaveNoViolations();
  });
  it("admin queue renders a seller-reply case (no review)", async () => {
    const el = createElement(QueueList, { items: [replyItem], onOpen: () => undefined });
    expect(renderToStaticMarkup(el)).toContain("Our reply text");
    expect(await check(el)).toHaveNoViolations();
  });
});
