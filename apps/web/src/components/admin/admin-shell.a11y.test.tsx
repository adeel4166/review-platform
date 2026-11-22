// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { AdminShellView, STAFF_LINKS } from "./AdminShell";
import { QueueList } from "./QueueList";
import { QueueEmpty, QueueError, QueueLoading } from "./QueueStates";
import { ClaimsQueue } from "./ClaimsQueue";
import type { QueueItem } from "@/lib/moderation-admin";

expect.extend(toHaveNoViolations);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), usePathname: () => "/admin/moderation" }));

async function check(el: ReactElement) {
  document.body.innerHTML = renderToStaticMarkup(el);
  return axe(document.body, { rules: { region: { enabled: false } } });
}
const item: QueueItem = {
  id: "c1", state: "NEEDS_HUMAN", aiScore: "0.620", aiConfidence: "0.8", aiReasons: ["x"], aiProvider: "fake", decisionReason: null, createdAt: "2026-01-01T00:00:00Z",
  review: { id: "r1", rating: 2, title: "Bad", body: "Body", verifiedBuyer: true, author: { handle: "al" }, _count: { media: 1 } },
};

describe("admin shell a11y", () => {
  const shell = (path: string, child: ReactElement) => createElement(AdminShellView, { pathname: path, children: createElement("main", null, createElement("h1", null, "Queue"), child) });
  it("shell with rail, Staff badge, queue table has no violations", async () => {
    expect(await check(shell("/admin/moderation", createElement(QueueList, { items: [item], selectedId: "c1", onOpen: () => undefined })))).toHaveNoViolations();
  });
  it("links every staff queue and marks only the current one", () => {
    const html = renderToStaticMarkup(shell("/admin/proofs", createElement("p")));
    for (const [href] of STAFF_LINKS) expect(html).toContain(`href="${href}"`);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/href="\/admin\/proofs"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/admin\/proofs"/);
    expect(html).toContain('aria-label="Staff"');
    expect(html).toContain("Staff</span>");
  });
  it("covers all seven required queues", () => {
    expect(STAFF_LINKS.map(([h]) => h).sort()).toEqual(["/admin/appeals", "/admin/approvals", "/admin/enforcement", "/admin/media", "/admin/moderation", "/admin/proofs", "/admin/seller-claims"]);
  });
  it("queue table has caption, column headers and a keyboard-reachable button per row", () => {
    const html = renderToStaticMarkup(createElement(QueueList, { items: [item], onOpen: () => undefined }));
    expect(html).toContain("<caption");
    expect(html).toContain('scope="col"');
    expect(html).toMatch(/<button[^>]*>Bad/);
  });
  it("loading, empty and error states", async () => {
    expect(await check(shell("/admin/media", createElement("div", null, createElement(QueueLoading, { label: "Loading" }), createElement(QueueEmpty, { message: "None" }), createElement(QueueError, null, "Failed"))))).toHaveNoViolations();
    expect(renderToStaticMarkup(createElement(QueueEmpty, { message: "None" }))).toContain("Queue is clear");
    expect(renderToStaticMarkup(createElement(QueueError, null, "x"))).toContain('role="alert"');
  });
  it("claims queue initial (loading) state", async () => {
    expect(await check(shell("/admin/seller-claims", createElement(ClaimsQueue)))).toHaveNoViolations();
  });
});
