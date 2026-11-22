// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/upload";
import { ReviewCard, type PublicReview } from "./ReviewCard";
import { ReviewVote, voteErrorKey } from "./ReviewVote";
import { ReportDialog } from "./ReportDialog";
import { VerifiedBadge, verifiedLabel } from "./VerifiedBadge";
import { VerifiedFilter } from "./VerifiedFilter";
import { OwnReviewActions, editErrorKey, validateEdit } from "./OwnReviewActions";
import { ProofPanel, proofErrorKey, validateProofForm } from "./ProofPanel";
import { ProofsQueue, validateReason, BREAK_GLASS_MIN } from "./admin/ProofsQueue";

expect.extend(toHaveNoViolations);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

async function check(el: ReactElement) {
  document.body.innerHTML = `<main><h1>Page</h1><h2>Reviews</h2><h3>Review title</h3>${renderToStaticMarkup(el)}</main>`;
  return axe(document.body);
}
const viewer = { signedIn: true, loginHref: "/login" };
const review: PublicReview = {
  id: "r1", rating: 4, title: "Solid", body: "A solid product overall.", verifiedPurchaseAt: "2026-01-01T00:00:00Z", verificationMethod: "RECEIPT_UPLOAD",
  editedAt: "2026-01-03T00:00:00Z", helpfulCount: 3, notHelpfulCount: 1, myVote: "HELPFUL", publishedAt: "2026-01-02T00:00:00Z", author: { handle: "a", displayName: "Alice" }, media: [],
};

describe("M4 review UI", () => {
  it("shows method label, edited indicator and vote counts", () => {
    const html = renderToStaticMarkup(createElement(ReviewCard, { review, viewer }));
    expect(html).toContain("Verified purchase · receipt");
    expect(html).toContain("Edited");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Helpful, 3 so far");
    expect(html).toContain("Not helpful, 1 so far");
    expect(html).toContain("Report");
  });
  it("labels each verification method and falls back for legacy verified reviews", () => {
    expect(verifiedLabel("ORDER_CONFIRMATION")).toBe("Verified purchase · order confirmation");
    expect(verifiedLabel("MARKETPLACE_ORDER_LINK")).toBe("Verified purchase · marketplace order");
    expect(verifiedLabel(null)).toBe("Verified purchase");
  });
  it("hides the edited indicator and badge when not applicable; signed-out users get sign-in links", () => {
    const html = renderToStaticMarkup(createElement(ReviewCard, { review: { ...review, editedAt: null, verifiedPurchaseAt: null }, viewer: { signedIn: false, loginHref: "/login?x" } }));
    expect(html).not.toContain("Edited");
    expect(html).not.toContain("Verified purchase");
    expect(html).toContain("Sign in to vote");
    expect(html).toContain("Sign in to report");
  });
  it("hides Report on the author's own review", () => {
    const html = renderToStaticMarkup(createElement(ReviewCard, { review, viewer, ownBox: createElement("p", null, "own") }));
    expect(html).not.toContain("Report review");
  });
  it("axe: card with votes, report, badge", async () => {
    expect(await check(createElement(ReviewCard, { review, viewer }))).toHaveNoViolations();
    expect(await check(createElement(ReviewCard, { review, viewer: { signedIn: false, loginHref: "/login" } }))).toHaveNoViolations();
  });
  it("axe: vote, report trigger, badge, filter switch", async () => {
    expect(await check(createElement(ReviewVote, { reviewId: "r", helpful: 1, notHelpful: 0, myVote: null, signedIn: true, loginHref: "/l" }))).toHaveNoViolations();
    expect(await check(createElement(ReportDialog, { reviewId: "r", reviewTitle: "T", signedIn: true, loginHref: "/l" }))).toHaveNoViolations();
    expect(await check(createElement(VerifiedBadge, { method: "RECEIPT_UPLOAD" }))).toHaveNoViolations();
    expect(await check(createElement(VerifiedFilter, { on: true, href: "/p" }))).toHaveNoViolations();
    expect(renderToStaticMarkup(createElement(VerifiedFilter, { on: true, href: "/p" }))).toContain('role="switch"');
  });
  it("axe: own review actions and proof panel in each state", async () => {
    const own = { version: 2, verified: false, consentVersion: "2026-12", proofs: [] };
    expect(await check(createElement(OwnReviewActions, { reviewId: "r", rating: 4, title: "T", body: "Body body body", own }))).toHaveNoViolations();
    for (const status of ["PENDING", "REJECTED", "EXPIRED", "DRAFT"] as const) {
      const html = renderToStaticMarkup(createElement(ProofPanel, { reviewId: "r", verified: false, consentVersion: "v", initial: [{ id: "p", status, method: "RECEIPT_UPLOAD", decisionReasonCode: status === "REJECTED" ? "UNREADABLE" : null }] }));
      expect(html).toContain("Proof status");
      expect(await check(createElement(ProofPanel, { Heading: "h4", reviewId: "r", verified: false, consentVersion: "v", initial: [{ id: "p", status, method: "RECEIPT_UPLOAD", decisionReasonCode: null }] }))).toHaveNoViolations();
    }
    expect(renderToStaticMarkup(createElement(ProofPanel, { reviewId: "r", verified: false, consentVersion: "v", initial: [] }))).toContain("Add proof of purchase");
    expect(renderToStaticMarkup(createElement(ProofPanel, { reviewId: "r", verified: true, consentVersion: "v", initial: [] }))).not.toContain("Add proof of purchase");
  });
  it("axe: admin proofs queue (loading)", async () => {
    expect(await check(createElement(ProofsQueue, { staffId: "s1" }))).toHaveNoViolations();
  });
});

describe("M4 client rules", () => {
  it("maps API errors to messages", () => {
    expect(voteErrorKey(new ApiError(403, "SELF_VOTE"))).toBe("vote.err.SELF_VOTE");
    expect(voteErrorKey(new ApiError(429, "rate_limited"))).toBe("vote.err.rate_limited");
    expect(voteErrorKey(new Error("x"))).toBe("vote.err.generic");
    expect(editErrorKey(new ApiError(409, "version_conflict"))).toBe("own.edit.err.version_conflict");
    expect(proofErrorKey(new ApiError(409, "proof_attempts_exhausted"))).toBe("proof.err.proof_attempts_exhausted");
    expect(proofErrorKey(new ApiError(415, "x"))).toBe("proof.err.unsupported");
  });
  it("validates edit, proof and break-glass inputs", () => {
    expect(validateEdit("", "long enough body")).toBe("own.edit.err.title");
    expect(validateEdit("T", "short")).toBe("own.edit.err.short");
    expect(validateEdit("T", "long enough body")).toBeNull();
    expect(validateProofForm({ method: "RECEIPT_UPLOAD", consent: true, files: 0, orderRef: "" })).toBe("proof.err.files");
    expect(validateProofForm({ method: "RECEIPT_UPLOAD", consent: false, files: 1, orderRef: "" })).toBe("proof.err.consent");
    expect(validateProofForm({ method: "MARKETPLACE_ORDER_LINK", consent: true, files: 0, orderRef: " " })).toBe("proof.err.order");
    expect(validateProofForm({ method: "MARKETPLACE_ORDER_LINK", consent: true, files: 0, orderRef: "123" })).toBeNull();
    expect(validateReason("short")).toBe("admin.proofs.bg.err.short");
    expect(validateReason("x".repeat(BREAK_GLASS_MIN))).toBeNull();
  });
});
