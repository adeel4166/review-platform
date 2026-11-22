// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { DashboardNav } from "./DashboardNav";
import { SectionCard, SellerPicker, VerificationStatusCard } from "./SellerCards";
import { CreateSellerForm } from "./CreateSellerForm";

expect.extend(toHaveNoViolations);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

async function check(el: ReactElement) {
  document.body.innerHTML = `<main><h1>Page</h1>${renderToStaticMarkup(el)}</main>`;
  return axe(document.body);
}

describe("seller dashboard a11y", () => {
  it("seller picker with sellers and with the empty state", async () => {
    const sellers = [{ id: "s1", name: "Acme Store", role: "OWNER", status: "VERIFIED" }, { id: "s2", name: "Beta", role: "RESPONDER", status: "PENDING" }];
    expect(await check(createElement(SellerPicker, { sellers }))).toHaveNoViolations();
    const html = renderToStaticMarkup(createElement(SellerPicker, { sellers }));
    expect(html).toContain("Status: VERIFIED"); // status is text, not colour
    expect(html).toContain('href="/sellers/new"');
    const empty = renderToStaticMarkup(createElement(SellerPicker, { sellers: [] }));
    expect(empty).toContain("Register your business");
    expect(await check(createElement(SellerPicker, { sellers: [] }))).toHaveNoViolations();
  });
  it("overview cards: status card in each state plus nav", async () => {
    for (const [verified, inProgress] of [[true, false], [false, true], [false, false]] as const) {
      expect(await check(createElement("div", null, createElement(DashboardNav, { sellerId: "s1", current: "overview" }),
        createElement(VerificationStatusCard, { sellerId: "s1", verified, inProgress, canManage: true }),
        createElement(SectionCard, { id: "x-h", title: "Needs your attention", children: createElement("p", null, "ok") })))).toHaveNoViolations();
    }
  });
  it("status card hides the verification link from members who cannot manage (server still enforces)", () => {
    expect(renderToStaticMarkup(createElement(VerificationStatusCard, { sellerId: "s1", verified: false, inProgress: false, canManage: false }))).not.toContain("/verification");
    expect(renderToStaticMarkup(createElement(VerificationStatusCard, { sellerId: "s1", verified: false, inProgress: false, canManage: true }))).toContain("/seller/s1/verification");
  });
  it("nav marks the current section and form is accessible at card width", async () => {
    expect(renderToStaticMarkup(createElement(DashboardNav, { sellerId: "s1", current: "verification" }))).toMatch(/aria-current="page"[^>]*>Verification|href="\/seller\/s1\/verification"[^>]*aria-current="page"/);
    expect(await check(createElement(CreateSellerForm))).toHaveNoViolations();
  });
});
