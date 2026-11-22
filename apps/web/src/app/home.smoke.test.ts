import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The layout loads next/font (build-time) and reads the CSP nonce from request headers; neither exists in a unit run.
vi.mock("next/font/google", () => ({ Inter: () => ({ variable: "inter-var", className: "inter" }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-nonce": "test-nonce" }) }));

import RootLayout from "./layout";
import Home from "./page";

/**
 * SMK-002: web shell smoke. The document must be a valid, language-tagged page with a main landmark.
 * Uses createElement (not JSX) because tsconfig sets "jsx": "preserve" for Next.js.
 */
describe("home page shell (smoke, SMK-002)", () => {
  let html = "";
  beforeAll(async () => { html = renderToStaticMarkup(await RootLayout({ children: createElement(Home) })); });

  it("declares the document language (WCAG 3.1.1)", () => {
    expect(html).toMatch(/<html lang="en"/);
  });

  it("renders a main landmark with a level-1 heading", () => {
    expect(html).toMatch(/<main[^>]*>/);
    expect(html).toMatch(/<h1[^>]*>.*Review Platform.*actually trust.*<\/h1>/);
  });
});
