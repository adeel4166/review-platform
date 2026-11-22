// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/upload";
import { holdText, shortcutFor } from "@/lib/moderation-admin";
import { noticeOf } from "@/server/m6-ui";
import { QueueList } from "./admin/QueueList";
import { CaseDetailView } from "./admin/CaseDetail";
import { OriginalAccessDialog, originalAccessErrorKey, validateOriginalReason } from "./admin/OriginalAccess";
import { AppealForm, appealErrorKey, validateAppeal } from "./m6/AppealForm";
import { EnforcementForm, pathFor, validateEnforcement } from "./m6/EnforcementForm";
import { NotificationCenter, groupPrefs, notifHref } from "./m6/NotificationCenter";
import { StaffAppeals, staffAppealErrorKey } from "./m6/StaffAppeals";
import { StaffApprovals, approvalErrorKey } from "./m6/StaffApprovals";
import { FollowButton } from "./m6/FollowButton";
import { ProfileEditor, profileErrorKey } from "./m6/ProfileEditor";
import { TrustBand } from "./TrustBand";

expect.extend(toHaveNoViolations);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined, back: () => undefined }) }));

async function check(el: ReactElement) {
  document.body.innerHTML = `<main><h1>Page</h1><h2>Section</h2>${renderToStaticMarkup(el)}</main>`;
  return axe(document.body);
}
const key = (e: KeyboardEventInit & { target?: { tagName?: string } }, on = true) => shortcutFor({ key: e.key ?? "", ctrlKey: e.ctrlKey, target: e.target ?? { tagName: "BODY" } }, on);
const NOW = Date.parse("2027-01-10T00:00:00Z");

describe("staff queue keyboard path (A11Y-004, WCAG 2.1.4)", () => {
  it("maps A/R/J/K and ignores typing, modifiers and the off switch", () => {
    expect(key({ key: "a" })).toBe("approve");
    expect(key({ key: "R" })).toBe("reject");
    expect(key({ key: "j" })).toBe("next");
    expect(key({ key: "k" })).toBe("prev");
    expect(key({ key: "a", target: { tagName: "TEXTAREA" } })).toBeNull();
    expect(key({ key: "a", ctrlKey: true })).toBeNull();
    expect(key({ key: "a" }, false)).toBeNull();
    expect(key({ key: "x" })).toBeNull();
  });
});

describe("hold expiry in the UI (E2E-003)", () => {
  it("renders time left, then 'expired'", () => {
    expect(holdText("2027-01-12T04:00:00Z", NOW)).toEqual({ expired: false, left: "2d 4h" });
    expect(holdText("2027-01-09T00:00:00Z", NOW)).toEqual({ expired: true, left: "" });
    expect(holdText(null, NOW)).toBeNull();
  });
  const item = { id: "c1", state: "NEEDS_HUMAN" as const, aiScore: 0.6, aiConfidence: 0.5, aiReasons: null, aiProvider: null, decisionReason: null, createdAt: "2027-01-01T00:00:00Z", holdExpiresAt: "2027-01-12T04:00:00Z",
    review: { id: "r1", rating: 3, title: "Meh", body: "Body text here", verifiedBuyer: false, author: { handle: "a" }, _count: { media: 0 } } };
  it("shows the hold deadline as text and is accessible", async () => {
    const html = renderToStaticMarkup(createElement(QueueList, { items: [item], onOpen: () => undefined, now: NOW }));
    expect(html).toContain("Hold expires in 2d 4h");
    expect(await check(createElement(QueueList, { items: [{ ...item, holdExpiresAt: "2027-01-01T00:00:00Z" }], onOpen: () => undefined, now: NOW }))).toHaveNoViolations();
  });
});

describe("conflict of interest (E2E-008)", () => {
  const detail = { id: "c1", state: "NEEDS_HUMAN" as const, aiScore: 0.5, aiConfidence: 0.5, aiReasons: null, aiProvider: null, decisionReason: null, createdAt: "x",
    review: { id: "r1", authorId: "me", rating: 4, title: "Mine", body: "My own review", verifiedBuyer: false, author: { handle: "me" }, media: [] } };
  it("hides decide controls on the staff member's own review", () => {
    const own = renderToStaticMarkup(createElement(CaseDetailView, { detail, viewerId: "me", onDecided: () => undefined }));
    expect(own).toContain("coi-banner");
    expect(own).not.toContain("decision-approve");
    const other = renderToStaticMarkup(createElement(CaseDetailView, { detail, viewerId: "someone", onDecided: () => undefined }));
    expect(other).toContain("decision-approve");
  });
});

describe("author notice and appeal window (E2E-002/003/005)", () => {
  const base = { id: "c", status: "RESOLVED", outcome: "REMOVE", lane: "HOLD", trigger: "SUBMISSION", resolvedAt: new Date(NOW - 86_400_000), appealableUntil: new Date(NOW + 5 * 86_400_000) };
  it("open case is 'under review'", () => expect(noticeOf({ ...base, status: "OPEN", outcome: null }, null, new Date(NOW), false, false).kind).toBe("UNDER_REVIEW"));
  it("hold-expired rejection: reason is 'not reviewed in time', appealable", () => {
    const n = noticeOf({ ...base, resolutionCode: "HOLD_EXPIRED" }, null, new Date(NOW), false, false);
    expect(n).toMatchObject({ kind: "NOT_PUBLISHED", notReviewedInTime: true, source: "NOT_REVIEWED_IN_TIME", canAppeal: true });
  });
  it("appeal link disappears after appealableUntil, to the second", () => {
    const at = (ms: number) => noticeOf({ ...base, appealableUntil: new Date(NOW) }, null, new Date(ms), false, false);
    expect(at(NOW - 1).canAppeal).toBe(true);
    expect(at(NOW).canAppeal).toBe(false);
    expect(at(NOW).appealClosed).toBe(true);
  });
  it("an open appeal removes the button", () => expect(noticeOf(base, null, new Date(NOW), true, false).canAppeal).toBe(false));
  it("an overturned appeal shows 'restored'", () => expect(noticeOf({ ...base, outcome: "APPROVE" }, null, new Date(NOW), true, true).kind).toBe("RESTORED"));
});

describe("appeal form", () => {
  it("validates in the order the user can fix", () => {
    expect(validateAppeal("short", true)).toBe("appeal.err.short");
    expect(validateAppeal("x".repeat(2001), true)).toBe("appeal.err.long");
    expect(validateAppeal("x".repeat(20), false)).toBe("appeal.err.understood");
    expect(validateAppeal("x".repeat(20), true)).toBeNull();
  });
  it("maps server codes", () => {
    expect(appealErrorKey(new ApiError(403, "appeal_window_closed"))).toBe("appeal.err.closed");
    expect(appealErrorKey(new ApiError(409, "appeal_exists"))).toBe("appeal.err.exists");
  });
  it("has no axe violations", async () => expect(await check(createElement(AppealForm, { caseId: "c", summary: "Summary" }))).toHaveNoViolations());
});

describe("break-glass prompt uses the server rules", () => {
  it("requires 20+ characters like REASON_MIN", () => {
    expect(validateOriginalReason("x".repeat(19))).toBe("admin.bg.err.short");
    expect(validateOriginalReason("x".repeat(20))).toBeNull();
    expect(validateOriginalReason("x".repeat(501))).toBe("admin.bg.err.long");
  });
  it("explains step-up, cap and conflict errors", () => {
    expect(originalAccessErrorKey(new ApiError(401, "step_up_required"))).toBe("admin.bg.err.stepUp");
    expect(originalAccessErrorKey(new ApiError(429, "break_glass_cap"))).toBe("admin.bg.err.cap");
    expect(originalAccessErrorKey(new ApiError(403, "conflict_of_interest"))).toBe("admin.bg.err.coi");
  });
  it("dialog is accessible", async () => expect(await check(createElement(OriginalAccessDialog, { proofId: "p", fileId: "f", onClose: () => undefined }))).toHaveNoViolations());
});

describe("staff screens", () => {
  it("enforcement validates and routes", () => {
    expect(validateEnforcement({ targetId: "", reasonCode: "X_Y", publicReason: "abc" })).toBe("enf.err.target");
    expect(validateEnforcement({ targetId: "s1", reasonCode: "bad code", publicReason: "abc" })).toBe("enf.err.code");
    expect(validateEnforcement({ targetId: "s1", reasonCode: "SPAM", publicReason: "ab" })).toBe("enf.err.reason");
    expect(validateEnforcement({ targetId: "s1", reasonCode: "SPAM", publicReason: "abc" })).toBeNull();
    expect(pathFor("SELLER_SUSPENSION", "s1")).toBe("/api/admin/sellers/s1/suspend");
    expect(pathFor("USER_REPLY_RESTRICTION", "u1")).toBe("/api/admin/users/u1/reply-restriction");
  });
  it("maps approval and appeal errors", () => {
    expect(approvalErrorKey(new ApiError(403, "approval_self"))).toBe("ap4.err.self");
    expect(staffAppealErrorKey(new ApiError(403, "CONFLICT_OF_INTEREST"))).toBe("sa.err.coi");
  });
  it.each([["enforcement", EnforcementForm, {}], ["appeals", StaffAppeals, {}], ["approvals", StaffApprovals, { staffId: "s" }]] as const)("%s is accessible", async (_n, C, props) => {
    expect(await check(createElement(C as never, props as never))).toHaveNoViolations();
  });
});

describe("trust, profile, notifications", () => {
  it("shows the band as text, never a number", () => {
    const html = renderToStaticMarkup(createElement(TrustBand, { band: "HIGH" }));
    expect(html).toContain("Trust: High");
    expect(renderToStaticMarkup(createElement(TrustBand, { band: "weird" }))).toContain("Trust: New");
  });
  it("mandatory notification types are locked in the view model", () => {
    const rows = [{ type: "CONTENT_REJECTED", channel: "EMAIL" as const, enabled: true, mandatory: true }, { type: "NEW_FOLLOWER", channel: "EMAIL" as const, enabled: false, mandatory: false }];
    expect(groupPrefs(rows).map(([t]) => t)).toEqual(["CONTENT_REJECTED", "NEW_FOLLOWER"]);
    expect(notifHref({ type: "CONTENT_REJECTED", entityType: "ModerationCase", entityId: "c1" })).toBe("/decisions/c1");
  });
  it("maps profile errors", () => expect(profileErrorKey(new ApiError(409, "handle_taken"))).toBe("profile.err.taken"));
  it.each([["trust", TrustBand, { band: "MEDIUM" }], ["notifications", NotificationCenter, {}], ["follow", FollowButton, { userId: "u", handle: "h", followId: null }], ["profile editor", ProfileEditor, { initial: { handle: "me", displayName: "Me", bio: null } }]] as const)("%s is accessible", async (_n, C, props) => {
    expect(await check(createElement(C as never, props as never))).toHaveNoViolations();
  });
});
