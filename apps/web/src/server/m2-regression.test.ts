import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Regression pins for the M2 hardening tasks (#37-#41). Behaviour is covered by the suites named in each comment;
// these tests fail if the configuration those fixes depend on is silently reverted.
const repo = (p: string) => readFileSync(fileURLToPath(new URL(`../../../../${p}`, import.meta.url)), "utf8");

describe("M2 hardening regressions", () => {
  it("SEC-01 (M2-8): next-auth stays on a patched 5.0.0-beta line (>= beta.32)", () => {
    const pkg = JSON.parse(repo("apps/web/package.json")) as { dependencies: Record<string, string> };
    const v = pkg.dependencies["next-auth"];
    expect(v).toMatch(/^(5\.0\.0-beta\.(3[2-9]|[4-9]\d)|5\.[1-9]\d*\.\d+.*)$/);
  });

  it("SEC-01 (M2-8): CI keeps the blocking high/critical production audit gate", () => {
    expect(repo(".github/workflows/ci.yml")).toContain("pnpm audit --prod --audit-level=high");
  });

  // SEC-02 (M2-9) is pinned in apps/web/src/server/media.test.ts ("media on non-PENDING reviews (SEC-02)").
  // SEC-03 / SEC-05 (M2-10) are pinned in ratelimit.test.ts and media.test.ts ("upload quota (SEC-03)").
  // SEC-04 / SEC-06 / SEC-09 (M2-11) are pinned in security.test.ts and admin-authz.test.ts.
  // SEC-13 (M2-12) is pinned in apps/web/e2e/auth.spec.ts and src/lib/callback-url.test.ts.
  it("M2-9..M2-12 regression anchors exist in the suites they point to", () => {
    expect(repo("apps/web/src/server/media.test.ts")).toContain("SEC-02");
    expect(repo("apps/web/src/server/media.test.ts")).toContain("upload quota (SEC-03)");
    expect(repo("apps/web/src/server/security.test.ts")).toContain("security headers");
    expect(repo("apps/web/src/server/admin-authz.test.ts")).toContain("SEC-09a");
    expect(repo("apps/web/e2e/auth.spec.ts")).toContain("E2E-AUTH-005");
    expect(repo("apps/web/src/lib/callback-url.test.ts").length).toBeGreaterThan(0);
  });
});
