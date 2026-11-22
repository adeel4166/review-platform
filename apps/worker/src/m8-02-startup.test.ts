import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { assertModerationProviderConfigured } from "@rp/core";

describe("M8-02 startup checks fail closed", () => {
  it("production with MODERATION_PROVIDER unset or mock is refused", () => {
    expect(() => assertModerationProviderConfigured({ NODE_ENV: "production" })).toThrow(/MODERATION_PROVIDER/);
    expect(() => assertModerationProviderConfigured({ NODE_ENV: "production", MODERATION_PROVIDER: "mock" })).toThrow(/MODERATION_PROVIDER/);
  });
  it("an unsupported provider name is refused in every environment", () => {
    expect(() => assertModerationProviderConfigured({ NODE_ENV: "production", MODERATION_PROVIDER: "nope" })).toThrow(/Unsupported/);
  });
  it("dev/CI keep the offline mock", () => {
    expect(assertModerationProviderConfigured({ MODERATION_PROVIDER: "mock" })).toBe("mock");
  });
  it("the core worker entrypoint exits 1 in production with the provider unset (names only in the log)", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/core-main.ts"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        PATH: process.env.PATH, NODE_ENV: "production", MEDIA_SANDBOX_REQUIRED: "false", IP_HASH_KEY: "x".repeat(40),
        DATABASE_URL: "mysql://u:p@127.0.0.1:1/x", REDIS_URL: "redis://127.0.0.1:1", S3_ENDPOINT: "http://127.0.0.1:1",
        S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "b", S3_BUCKET_INGEST: "i", S3_BUCKET_PRIVATE: "p", S3_BUCKET_PUBLIC: "u",
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("MODERATION_PROVIDER");
  });
});
