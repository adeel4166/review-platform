import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";
import { beforeSend, createLogger, REDACTED, scrub } from "./log-scrub";

const base = { DATABASE_URL: "mysql://u:p@db:3306/x", REDIS_URL: "redis://r:6379", S3_ENDPOINT: "https://s3.example.com", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", S3_BUCKET_INGEST: "i", S3_BUCKET_PRIVATE: "p", S3_BUCKET_PUBLIC: "pub" };

describe("OPS-004 production env defaults", () => {
  it("LOG_SCRUB defaults to on and PROOF_ORIGINAL_RETENTION to AT_DECISION", () => {
    const e = loadEnv({ ...base, NODE_ENV: "production" });
    expect(e.LOG_SCRUB).toBe("on");
    expect(e.PROOF_ORIGINAL_RETENTION).toBe("AT_DECISION");
  });
  it("LOG_SCRUB=off is refused in production (names only in the error)", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "production", LOG_SCRUB: "off" })).toThrow(/LOG_SCRUB/);
    expect(() => loadEnv({ ...base, NODE_ENV: "production", LOG_SCRUB: "off" })).not.toThrow(/mysql:/);
  });
  it("LOG_SCRUB=off is allowed only outside production; unknown retention mode refuses to boot", () => {
    expect(loadEnv({ ...base, NODE_ENV: "development", LOG_SCRUB: "off" }).LOG_SCRUB).toBe("off");
    expect(() => loadEnv({ ...base, PROOF_ORIGINAL_RETENTION: "FOREVER" })).toThrow(/PROOF_ORIGINAL_RETENTION/);
  });
});

describe("OPS-004 scrubber canary (PRV-001)", () => {
  const CANARY = { email: "canary.user@example.org", note: "contact canary.user@example.org from 203.0.113.9 or 2001:db8:85a3:0:0:8a2e:370:7334", headers: { authorization: "Bearer abcdef0123456789", cookie: "sid=1" }, nested: [{ ip: "198.51.100.7", msg: "ok" }] };
  const leaks = (s: string) => /canary\.user|203\.0\.113\.9|2001:db8|abcdef0123456789|198\.51\.100\.7|sid=1/.test(s);
  it("logger redacts the canary when scrubbing is on", () => {
    const lines: string[] = [];
    createLogger(loadEnv({ ...base, NODE_ENV: "production" }).LOG_SCRUB === "on", (l) => lines.push(l))(CANARY);
    expect(lines[0]).toContain(REDACTED);
    expect(leaks(lines[0]!)).toBe(false);
  });
  it("beforeSend redacts the canary in an error-tracker event and drops bodies, cookies and user ip", () => {
    const ev = beforeSend({ message: "failed for canary.user@example.org", request: { data: { email: "canary.user@example.org" }, cookies: "sid=1", url: "/x" }, user: { id: "u1", email: "canary.user@example.org", ip_address: "203.0.113.9" }, extra: CANARY, exception: new Error("boom 203.0.113.9") });
    expect(leaks(JSON.stringify(ev))).toBe(false);
    expect((ev as { user: unknown }).user).toEqual({ id: "u1" });
    expect((ev as { request: Record<string, unknown> }).request.data).toBeUndefined();
  });
  it("scrub keeps non-sensitive values", () => expect(scrub({ caseId: "c1", n: 3 })).toEqual({ caseId: "c1", n: 3 }));
});
