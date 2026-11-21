import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { assertEgressEnv, forbiddenEgressEnv, parseWorkerGroup } from "./groups";

const ok = { REDIS_URL: "redis://x:6379", VERIFY_DNS_SERVERS: "1.1.1.1" };

describe("T-01 verification-egress startup assertion", () => {
  it("accepts REDIS_URL + VERIFY_DNS_SERVERS only", () => {
    expect(() => assertEgressEnv(ok)).not.toThrow();
  });
  it.each(["DATABASE_URL", "SMTP_URL", "S3_ENDPOINT", "S3_SECRET_ACCESS_KEY", "S3_BUCKET_PRIVATE"])("refuses to start with %s present", (k) => {
    expect(() => assertEgressEnv({ ...ok, [k]: "x" })).toThrow(k);
    expect(forbiddenEgressEnv({ ...ok, [k]: "x" })).toEqual([k]);
  });
  it("never echoes values and requires REDIS_URL", () => {
    expect(() => assertEgressEnv({ ...ok, DATABASE_URL: "mysql://secret-pw" })).not.toThrow(/secret-pw/ as never);
    expect(() => assertEgressEnv({ VERIFY_DNS_SERVERS: "1.1.1.1" })).toThrow(/REDIS_URL/);
  });
  it("parses WORKER_GROUPS: default core, exactly one group", () => {
    expect(parseWorkerGroup(undefined)).toBe("core");
    expect(parseWorkerGroup("verification-egress")).toBe("verification-egress");
    expect(() => parseWorkerGroup("core,verification-egress")).toThrow();
    expect(() => parseWorkerGroup("bogus")).toThrow();
  });
  it("the entrypoint exits non-zero when DATABASE_URL is present", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { PATH: process.env.PATH, WORKER_GROUPS: "verification-egress", REDIS_URL: "redis://127.0.0.1:1", DATABASE_URL: "mysql://u:p@h/db" },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("DATABASE_URL");
    expect(r.stderr).not.toContain("u:p@h");
  });
  it("core worker no longer instantiates the production fetcher", () => {
    for (const f of ["processors.ts", "core-main.ts", "main.ts"]) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
      expect(src).not.toMatch(/createProductionFetcher|createDnsResolver/);
    }
  });
});
