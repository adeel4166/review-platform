import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/upload";
import { decide, queueQueryString, removeCase, defaultFilters, type QueuePage, type QueueItem } from "@/lib/moderation-admin";
import { DecisionPanel } from "./admin/DecisionPanel";
import { CaseDetailView } from "./admin/CaseDetail";
import { QueueList } from "./admin/QueueList";
import { AuditTable } from "./admin/AuditLog";

const item = (id: string): QueueItem => ({
  id, state: "NEEDS_HUMAN", aiScore: "0.620", aiConfidence: "0.8", aiReasons: ["harassment"], aiProvider: "fake", decisionReason: null, createdAt: "2026-01-01T00:00:00Z",
  review: { id: "r" + id, rating: 2, title: "T" + id, body: "Body", verifiedBuyer: true, author: { handle: "al" }, _count: { media: 2 } },
});

describe("approve/reject flows", () => {
  it("approve posts to the approve endpoint without requiring a reason", async () => {
    const call = vi.fn(async () => ({ id: "c1", state: "APPROVED" }));
    const r = await decide("c1", "approve", "", call as never);
    expect(r).toEqual({ ok: true, id: "c1", state: "APPROVED" });
    expect(call).toHaveBeenCalledWith("/api/admin/moderation/c1/approve", { method: "POST", body: "{}" });
  });
  it("reject requires a reason and does not call the API without one", async () => {
    const call = vi.fn();
    expect(await decide("c1", "reject", " a ", call as never)).toEqual({ ok: false, errorKey: "mod.err.reasonRequired" });
    expect(call).not.toHaveBeenCalled();
  });
  it("reject sends the trimmed reason", async () => {
    const call = vi.fn(async () => ({ id: "c1", state: "REJECTED" }));
    expect((await decide("c1", "reject", "  spam  ", call as never)).ok).toBe(true);
    expect(call).toHaveBeenCalledWith("/api/admin/moderation/c1/reject", { method: "POST", body: JSON.stringify({ reason: "spam" }) });
  });
  it("maps 409 to a conflict, 403 to forbidden, others to generic", async () => {
    const fail = (s: number) => decide("c1", "approve", "", (async () => { throw new ApiError(s, "x"); }) as never);
    expect(await fail(409)).toEqual({ ok: false, errorKey: "mod.err.conflict" });
    expect(await fail(403)).toEqual({ ok: false, errorKey: "mod.err.forbidden" });
    expect(await fail(500)).toEqual({ ok: false, errorKey: "mod.err.generic" });
  });
  it("queue updates in place after a decision", () => {
    const page: QueuePage = { items: [item("1"), item("2")], page: 1, pageSize: 20, total: 2 };
    const next = removeCase(page, "1");
    expect(next.items.map((i) => i.id)).toEqual(["2"]);
    expect(next.total).toBe(1);
    expect(removeCase(next, "zzz")).toBe(next);
  });
  it("builds the queue query from filters, ignoring invalid scores", () => {
    expect(queueQueryString({ ...defaultFilters, minScore: "0.5", maxScore: "9", hasMedia: "true" })).toBe("state=NEEDS_HUMAN&page=1&pageSize=20&minScore=0.5&hasMedia=true");
  });
});

describe("admin components (SSR markup)", () => {
  it("DecisionPanel has labelled reason field and both actions", () => {
    const html = renderToStaticMarkup(createElement(DecisionPanel, { caseId: "c1", onDecided: () => {} }));
    expect(html).toMatch(/<label for="reason-c1"/);
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
    expect(html).toContain('role="alert"');
  });
  it("QueueList shows score, media count and an accessible open button; empty state otherwise", () => {
    const html = renderToStaticMarkup(createElement(QueueList, { items: [item("1")], onOpen: () => {} }));
    expect(html).toContain("AI score 0.62");
    expect(html).toContain("2 media");
    expect(renderToStaticMarkup(createElement(QueueList, { items: [], onOpen: () => {} }))).toContain("No cases match");
  });
  it("CaseDetailView shows AI reasons, media preview and decision panel only for open cases", () => {
    const d = { ...item("1"), review: { ...item("1").review, media: [{ id: "m", status: "READY", width: 1, height: 1, failureReason: null, thumbUrl: "https://x/t", mediumUrl: "https://x/m" }] } };
    const html = renderToStaticMarkup(createElement(CaseDetailView, { detail: d as never, onDecided: () => {} }));
    expect(html).toContain("harassment");
    expect(html).toContain('alt="Review media 1"');
    expect(html).toContain("Decision");
    expect(renderToStaticMarkup(createElement(CaseDetailView, { detail: { ...d, state: "APPROVED" } as never, onDecided: () => {} }))).not.toContain("<fieldset");
  });
  it("AuditTable renders rows", () => {
    const html = renderToStaticMarkup(createElement(AuditTable, { items: [{ id: "1", actorType: "STAFF", actorId: "u", action: "review.rejected", entityType: "Review", entityId: "r1", metadata: { reason: "spam" }, createdAt: "2026-01-01T00:00:00Z" }] }));
    expect(html).toContain("review.rejected");
    expect(html).toContain("spam");
  });
});
