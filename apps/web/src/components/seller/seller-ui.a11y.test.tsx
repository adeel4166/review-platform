// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { AcceptInvitation } from "./AcceptInvitation";
import { ClaimWizard, type ClaimView } from "./ClaimWizard";
import { CreateSellerForm } from "./CreateSellerForm";
import { DashboardNav } from "./DashboardNav";
import { EmailBannerView } from "./EmailVerificationBanner";
import { SellerVerifiedBadge } from "./SellerVerifiedBadge";
import { TeamPanel } from "./TeamPanel";
import { ClaimsQueue } from "../admin/ClaimsQueue";

expect.extend(toHaveNoViolations);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/** Wraps in landmarks like the real layout so region rules apply as they would on a page. */
async function check(el: ReactElement) {
  document.body.innerHTML = `<main><h1>Page</h1>${renderToStaticMarkup(el)}</main>`;
  return axe(document.body);
}

const claim = (o: Partial<ClaimView>): ClaimView => ({ id: "c1", method: "DNS_TXT", status: "PENDING", domain: "example.com", challengeExpiresAt: null, lastCheckOutcome: null, lastCheckAt: null, verifiedUntil: null, ...o });

describe("seller UI accessibility (jest-axe, WCAG 2.2 AA rules)", () => {
  it("SellerVerifiedBadge in punycode", async () => {
    const html = renderToStaticMarkup(createElement(SellerVerifiedBadge, { domain: "xn--bcher-kva.example" }));
    expect(html).toContain("Verified: xn--bcher-kva.example");
    expect(await check(createElement(SellerVerifiedBadge, { domain: "xn--bcher-kva.example" }))).toHaveNoViolations();
  });
  it("EmailBannerView", async () => {
    expect(await check(createElement(EmailBannerView, { busy: false, msg: null, onResend: () => undefined }))).toHaveNoViolations();
  });
  it("CreateSellerForm", async () => {
    expect(await check(createElement(CreateSellerForm))).toHaveNoViolations();
  });
  it("TeamPanel as owner and as responder", async () => {
    const members = [{ userId: "u1", role: "OWNER" as const, handle: "own", displayName: "Owner" }, { userId: "u2", role: "RESPONDER" as const, handle: "res", displayName: "Resp" }];
    const invitations = [{ id: "i1", email: "a@b.example", role: "MANAGER", expiresAt: "2026-12-01T00:00:00Z" }];
    expect(await check(createElement(TeamPanel, { sellerId: "s1", members, invitations, canInvite: true, canRemove: true, selfId: "u1" }))).toHaveNoViolations();
    const ro = renderToStaticMarkup(createElement(TeamPanel, { sellerId: "s1", members, invitations: [], canInvite: false, canRemove: false, selfId: "u2" }));
    expect(ro).not.toContain("Invite a member"); // hidden, not merely disabled (wireframe 10)
    expect(await check(createElement(TeamPanel, { sellerId: "s1", members, invitations: [], canInvite: false, canRemove: false, selfId: "u2" }))).toHaveNoViolations();
  });
  it("AcceptInvitation", async () => {
    expect(await check(createElement(AcceptInvitation, { token: "t".repeat(30), signedIn: true }))).toHaveNoViolations();
    expect(await check(createElement(AcceptInvitation, { token: "t".repeat(30), signedIn: false }))).toHaveNoViolations();
  });
  it("ClaimWizard: choose, in progress, verified", async () => {
    expect(await check(createElement(ClaimWizard, { sellerId: "s1", initialClaims: [] }))).toHaveNoViolations();
    const pending = renderToStaticMarkup(createElement(ClaimWizard, { sellerId: "s1", initialClaims: [claim({})] }));
    expect(pending).toContain("Pending");
    expect(await check(createElement(ClaimWizard, { sellerId: "s1", initialClaims: [claim({})] }))).toHaveNoViolations();
    expect(await check(createElement(ClaimWizard, { sellerId: "s1", initialClaims: [claim({ status: "VERIFIED", verifiedUntil: "2027-01-01T00:00:00Z", lastCheckOutcome: "PASS", lastCheckAt: "2026-01-01T00:00:00Z" })] }))).toHaveNoViolations();
    expect(await check(createElement(ClaimWizard, { sellerId: "s1", initialClaims: [claim({ method: "DOCUMENT", domain: null })] }))).toHaveNoViolations();
  });
  it("ClaimsQueue (loading state) and DashboardNav", async () => {
    expect(await check(createElement(ClaimsQueue))).toHaveNoViolations();
    expect(await check(createElement(DashboardNav, { sellerId: "s1", current: "verification" }))).toHaveNoViolations();
  });
  it("the badge component is server-only: no client directive, no state, no props other than the domain", () => {
    const src = readFileSync(join(process.cwd(), "src/components/seller/SellerVerifiedBadge.tsx"), "utf8");
    expect(src).not.toMatch(/^\s*["']use client["']/m);
    expect(src).not.toMatch(/useState|useEffect|fetch\(/);
  });
});
