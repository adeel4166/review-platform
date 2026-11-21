import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLayout from "./layout";
import Home from "./page";

/**
 * SMK-002: web shell smoke. The document must be a valid, language-tagged page with a main landmark.
 * Uses createElement (not JSX) because tsconfig sets "jsx": "preserve" for Next.js.
 */
describe("home page shell (smoke, SMK-002)", () => {
  const html = renderToStaticMarkup(createElement(RootLayout, null, createElement(Home)));

  it("declares the document language (WCAG 3.1.1)", () => {
    expect(html).toMatch(/<html lang="en"/);
  });

  it("renders a main landmark with a level-1 heading", () => {
    expect(html).toMatch(/<main[^>]*>/);
    expect(html).toMatch(/<h1[^>]*>Review Platform<\/h1>/);
  });
});
