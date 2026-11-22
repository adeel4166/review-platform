// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, it } from "vitest";
import { AiSummaryCard } from "./AiSummaryCard";
import { RatingDistributionChart, VerifiedVsAllChart } from "./ProductCharts";

expect.extend(toHaveNoViolations);
const html = (el: ReactElement) => renderToStaticMarkup(el);
const summary = { pros: ["Great sound"], cons: ["Pricey"], overview: "Buyers like the sound.", sourceReviewCount: 12 };

describe("V3-07 AI summary card and charts", () => {
  it("renders nothing without a summary", () => {
    expect(html(createElement(AiSummaryCard, { summary: null }))).toBe("");
    expect(html(createElement(AiSummaryCard, { summary: undefined }))).toBe("");
  });
  it("labels the source, starts collapsed, and has no axe violations", async () => {
    const out = html(createElement(AiSummaryCard, { summary }));
    expect(out).toContain("AI-generated from 12 verified reviews");
    expect(out).toContain('aria-expanded="false"');
    expect(out).toMatch(/hidden=""/);
    document.body.innerHTML = `<main><h1>P</h1>${out}</main>`;
    expect(await axe(document.body)).toHaveNoViolations();
  });
  it("uses the singular label for one review", () => {
    expect(html(createElement(AiSummaryCard, { summary: { ...summary, sourceReviewCount: 1 } }))).toContain("AI-generated from 1 verified review<");
  });
  it("charts expose text alternatives and have no axe violations", async () => {
    const hist = { 1: 1, 2: 0, 3: 2, 4: 5, 5: 12 };
    const a = html(createElement(RatingDistributionChart, { histogram: hist, count: 20 }));
    const b = html(createElement(VerifiedVsAllChart, { avg: 4.2, count: 20, verifiedAvg: 4.5, verifiedCount: 8 }));
    expect(a).toContain('role="img"');
    expect(b).toContain("Verified buyers: 4.5 out of 5, 8 reviews");
    document.body.innerHTML = `<main><h1>P</h1>${a}${b}</main>`;
    expect(await axe(document.body)).toHaveNoViolations();
  });
  it("says so when there are no verified ratings", () => {
    expect(html(createElement(VerifiedVsAllChart, { avg: 4, count: 3, verifiedAvg: null, verifiedCount: 0 }))).toContain("No verified-buyer ratings yet.");
  });
});
