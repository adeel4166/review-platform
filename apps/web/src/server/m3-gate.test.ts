import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// M3 QA gate (task #50, M3-07). Each P0 case tagged M3 in docs/qa/test-case-catalogue.md must be asserted by a suite
// that names the case ID in a describe/it title. The behaviour lives in those suites; this file fails if one is removed,
// renamed out of the gate, or if the catalogue gains an M3 P0 case with no anchor. Results: docs/qa/m3-gate-report.md.
const repo = (p: string) => readFileSync(fileURLToPath(new URL(`../../../../${p}`, import.meta.url)), "utf8");
const titled = (file: string, id: string) => new RegExp(`(describe|it)\\([\`"'][^\\n]*\\b${id}\\b`).test(repo(file));

const P0: Record<string, string[]> = {
  "SEL-001": ["packages/core/src/claims.test.ts"],
  "SEL-002": ["packages/core/src/domain-policy.test.ts"],
  "SEL-003": ["packages/core/src/claims.test.ts"],
  "SEL-004": ["packages/core/src/claims.test.ts"],
  "SEL-005": ["packages/core/src/claims.test.ts", "apps/worker/src/verification/checks.test.ts"],
  "SEL-007": ["apps/web/src/server/sellers.test.ts"],
  "SEL-009": ["apps/web/src/server/seller-views.test.ts"],
  "SEL-011": ["apps/web/src/server/sellers.test.ts", "packages/core/src/sellers.test.ts"],
  "SEL-012": ["apps/web/src/server/claims.test.ts"],
  "AZ-007": ["packages/core/src/sellers.test.ts", "apps/web/src/server/sellers.test.ts"],
  "AZ-010": ["packages/core/src/sellers.test.ts", "apps/web/src/server/sellers.test.ts"],
  "SEC-007": ["apps/worker/src/verification/safe-fetch.test.ts"],
};
// Catalogue P0 cases moved to the M3b gate (ADR-0017). Not part of the M3a gate.
const DEFERRED = ["SEL-006"];
// P1 M3 cases: anchored for information, not gating.
const P1: Record<string, string[]> = {
  "SEL-008": ["packages/core/src/claims.test.ts", "apps/worker/src/verification/checks.test.ts"],
  "SEL-010": ["packages/core/src/sellers.test.ts", "apps/web/src/server/sellers.test.ts"],
};

describe("M3 QA gate: catalogue coverage", () => {
  it("the catalogue's P0 M3 cases are exactly the anchored set, plus the deferred SEL-006", () => {
    const rows = [...repo("docs/qa/test-case-catalogue.md").matchAll(/^\| ([A-Z]+-\d{3}) \| \w+ \| M3 \| P0 \|/gm)].map((m) => m[1]!).sort();
    expect(rows).toEqual([...Object.keys(P0), ...DEFERRED].sort());
  });

  it.each(Object.entries(P0))("%s is asserted by a suite that names it", (id, files) => {
    expect(files.some((f) => titled(f, id))).toBe(true);
  });

  it.each(Object.entries(P1))("%s (P1) is asserted by a suite that names it", (id, files) => {
    expect(files.some((f) => titled(f, id))).toBe(true);
  });
});

describe("M3 QA gate: database guarantees behind SEL-011 and SEL-012", () => {
  // Service invariants are tested above; these CHECKs are the DB backstop that the service cannot bypass.
  const sql = () => repo("packages/db/prisma/migrations/20261202000000_sellers_claims_enforcement/migration.sql");

  it("SEL-011: a seller cannot be VERIFIED without a verified claim (chk_seller_verified_claim)", () => {
    expect(sql()).toContain("ADD CONSTRAINT `chk_seller_verified_claim`");
    expect(sql()).toContain("CHECK (`status` <> 'VERIFIED' OR (`verifiedClaimId` IS NOT NULL AND `verifiedAt` IS NOT NULL))");
  });

  it("SEL-012: PRODUCT scope requires productId and nothing else (chk_claim_product_scope)", () => {
    expect(sql()).toContain("ADD CONSTRAINT `chk_claim_product_scope`");
    expect(sql()).toContain("CHECK ((`scope` = 'PRODUCT') = (`productId` IS NOT NULL))");
  });
});

describe("M3 QA gate: regression pins for M3-02 and M3-03", () => {
  // M3-02: the limiter fails closed for login and register when Redis is down (ratelimit.test.ts, "Redis down (R-1)").
  it("M3-02: login and register fail closed when Redis is down", () => {
    expect(repo("apps/web/src/server/ratelimit.test.ts")).toContain("Redis down (R-1)");
    expect(repo("apps/web/src/server/ratelimit.test.ts")).toContain("register fails CLOSED");
    expect(repo("apps/web/src/server/ratelimit.test.ts")).toContain("login fails CLOSED");
  });

  // M3-03: registration gives an identical response for new and existing emails (m3-email.test.ts).
  it("M3-03: register gives an identical response for new and existing emails", () => {
    expect(repo("apps/web/src/server/m3-email.test.ts")).toContain("returns the identical response for a new and an existing email");
  });
});
