import { describe, expect, it } from "vitest";
import { jobId, loadEnv, mediaJobSchema, moderationJobSchema } from "./index";

const valid = {
  DATABASE_URL: "mysql://u:p@localhost:3306/db",
  REDIS_URL: "redis://localhost:6379",
  S3_ENDPOINT: "http://localhost:9000",
  S3_ACCESS_KEY_ID: "a",
  S3_SECRET_ACCESS_KEY: "b",
  S3_BUCKET_INGEST: "i",
  S3_BUCKET_PRIVATE: "p",
  S3_BUCKET_PUBLIC: "u",
};

describe("loadEnv", () => {
  it("applies defaults", () => {
    const env = loadEnv(valid);
    expect(env.WORKER_CONCURRENCY).toBe(2);
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
  });
  it("reports only key names on failure", () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: "secret-not-a-url" })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...valid, DATABASE_URL: "secret-not-a-url" })).not.toThrow(/secret-not-a-url/);
  });
});

describe("job schemas", () => {
  it("validates moderation payloads", () => {
    expect(moderationJobSchema.safeParse({ subjectType: "REVIEW", subjectId: "1", version: 0 }).success).toBe(true);
    expect(moderationJobSchema.safeParse({ subjectType: "NOPE", subjectId: "1", version: 0 }).success).toBe(false);
  });
  it("defaults media step", () => {
    expect(mediaJobSchema.parse({ assetId: "a" }).step).toBe("VALIDATE");
  });
  it("builds deterministic job ids", () => {
    expect(jobId("review", "7", 2)).toBe("review__7__2");
  });
});
