/** M6/M7 gate (task #82): live-wiring and report-flood assertions. Test code only. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createReport } from "./reports";
import { makeFakeDb } from "./m4-fake-db";

const NOW = new Date("2026-12-01T12:00:00Z");
const root = new URL("../../../../", import.meta.url).pathname;
const src = (p: string) => readFileSync(join(root, p), "utf8");
function nonTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(join(root, dir))) {
    const rel = join(dir, f);
    if (statSync(join(root, rel)).isDirectory()) out.push(...nonTestFiles(rel));
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(rel);
  }
  return out;
}

describe("MOD-022 report flood (F-9)", () => {
  it("50 reports from NEW accounts leave the review PUBLISHED, one case, weight 0", async () => {
    const h = makeFakeDb(["user", "review", "product", "reviewVote", "reviewRevision", "moderationCase", "report", "sellerReply", "sellerMember", "enforcementAction", "auditLog", "outboxEvent"], {
      review: (r, t) => ({ product: { sellerId: t.product!.find((p) => p.id === r.productId)?.sellerId ?? null, name: "W" } }),
    }, { moderationCase: { reportCount: 0, reportWeight: 0, seq: 1, trigger: "SUBMISSION" }, report: { status: "OPEN" }, review: { helpfulCount: 0, notHelpfulCount: 0, currentVersion: 1 } });
    h.t.user!.push({ id: "author", status: "ACTIVE", emailVerifiedAt: NOW, createdAt: new Date("2026-01-01") });
    h.t.product!.push({ id: "p1", sellerId: null, status: "ACTIVE" });
    h.t.review!.push({ id: "r1", productId: "p1", authorId: "author", status: "PUBLISHED", currentVersion: 1, publishedVersion: 1, rating: 5, title: "t", body: "a perfectly fine body", incentive: "NONE" });
    for (let i = 0; i < 50; i++) { h.t.user!.push({ id: `n${i}`, status: "ACTIVE", emailVerifiedAt: NOW, createdAt: NOW }); await createReport(h.db, `n${i}`, { reviewId: "r1" }, { reason: "SPAM" }, { now: NOW }); }
    expect(h.t.review![0]!.status).toBe("PUBLISHED");
    expect(h.t.moderationCase).toHaveLength(1);
    expect(h.t.moderationCase![0]).toMatchObject({ reportCount: 50, reportWeight: 0 });
  });
});

/** SEC-M5-M7 closure (task #83): QA-M6-01/02 and QA-M7-01 wiring is live; these are normal assertions now. */
describe("SEC-M6-01 (P0) role grants go through four-eyes", () => {
  it("the staff roles route must call requestRoleGrant and not grantStaffRole", () => {
    const route = src("apps/web/src/app/api/admin/staff/[id]/roles/route.ts");
    expect(route).toContain("requestRoleGrant");
    expect(route).not.toMatch(/grantStaffRole\(/);
  });
  it("userRole.upsert/create appears only in approvals.ts (and the MODERATOR path)", () => {
    const hits = nonTestFiles("apps/web/src").filter((f) => /userRole\.(upsert|create)\(/.test(src(f)));
    expect(hits.filter((f) => !/server\/approvals\.ts$/.test(f))).toEqual([]);
  });
});

describe("SEC-M6-02 (P0) production moderation is not the mock blocklist", () => {
  it("createModerationProvider refuses mock/unset in production", () => {
    const s = src("packages/core/src/moderation-provider.ts");
    expect(s).toMatch(/NODE_ENV[^\n]*production|production[^\n]*NODE_ENV/);
  });
  it("the moderation queue handler publishes through runAssess, not the legacy decideVerdict", () => {
    const s = src("apps/worker/src/processors.ts");
    expect(s).toContain("runAssess");
    expect(s).not.toContain("processModeration(getDb()");
  });
});

describe("SEC-M7-01 (P1) M7 entry points have a production caller", () => {
  const files = () => [...nonTestFiles("apps/worker/src"), ...nonTestFiles("apps/web/src")];
  for (const fn of ["routeReview", "recomputeSubject", "nightlyDecay", "detectVoteAnomaly"]) {
    it(`${fn} is referenced outside tests and its own definition`, () => {
      const def = new RegExp(`(function|const)\\s+${fn}\\b`);
      const refs = files().filter((f) => { const t = src(f); return !def.test(t) && new RegExp(`\\b${fn}\\b`).test(t); });
      expect(refs.length).toBeGreaterThan(0);
    });
  }
});
