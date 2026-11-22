import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATEGORIES, type HttpTransport } from "@rp/core";
import { liveProviderCall } from "./moderation/live";

const root = new URL("../../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(`${root}${p}`, "utf8");
const KEY = "sk-live01-secret-never-logged";
const scores = (v: number) => Object.fromEntries(CATEGORIES.map((c) => [c, v]));

describe("SEC-FIN-01 worker adapter (live.ts)", () => {
  it("forwards the scores-only call for ALL categories to the provider (no single-score mapping)", async () => {
    let body = "";
    const t: HttpTransport = async (r) => { body = r.body; return { status: 200, text: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ scores: { ...scores(0.01), violence_threats: 0.9 } }) }] }) }; };
    const call = liveProviderCall({ NODE_ENV: "production", MODERATION_PROVIDER: "anthropic", MODERATION_API_KEY: KEY }, t);
    const out = (await call({ system: "s", user: "u", timeoutMs: 1000 })) as string;
    expect(JSON.parse(out).scores.violence_threats).toBe(0.9);
    expect(JSON.parse(out).scores.spam).toBe(0.01);
    expect(body).not.toContain(KEY);
  });
  it("production refuses mock/unset when building the call", () => {
    expect(() => liveProviderCall({ NODE_ENV: "production" })).toThrow(/MODERATION_PROVIDER/);
    expect(() => liveProviderCall({ NODE_ENV: "production", MODERATION_PROVIDER: "mock" })).toThrow(/MODERATION_PROVIDER/);
    expect(() => liveProviderCall({ NODE_ENV: "production", MODERATION_PROVIDER: "anthropic" })).toThrow(/MODERATION_API_KEY/);
  });
});

const baseEnv = {
  PATH: process.env.PATH, NODE_ENV: "production", MEDIA_SANDBOX_REQUIRED: "false", IP_HASH_KEY: "x".repeat(40),
  DATABASE_URL: "mysql://u:p@127.0.0.1:1/x", REDIS_URL: "redis://127.0.0.1:1", S3_ENDPOINT: "http://127.0.0.1:1",
  S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "b", S3_BUCKET_INGEST: "i", S3_BUCKET_PRIVATE: "p", S3_BUCKET_PUBLIC: "u",
};
const cwd = new URL("..", import.meta.url).pathname;

describe("SEC-FIN-01 worker boot in production", () => {
  it("boots past the provider gate with a configured real provider, logs the NAME only, never the key", async () => {
    const out = await new Promise<string>((resolve) => {
      const p = spawn(process.execPath, ["--import", "tsx", "src/core-main.ts"], { cwd, env: { ...baseEnv, MODERATION_PROVIDER: "anthropic", MODERATION_API_KEY: KEY } });
      let buf = "";
      const done = () => { p.kill("SIGKILL"); resolve(buf); };
      const timer = setTimeout(done, 25_000);
      const on = (d: Buffer) => { buf += d.toString(); if (buf.includes("moderation.provider") || buf.includes("worker.startup.refused")) { clearTimeout(timer); done(); } };
      p.stdout.on("data", on); p.stderr.on("data", on);
      p.on("exit", () => { clearTimeout(timer); resolve(buf); });
    });
    expect(out).toContain('"provider":"anthropic"');
    expect(out).not.toContain("worker.startup.refused");
    expect(out).not.toContain(KEY);
  }, 40_000);
  it.each([["unset", {}], ["mock", { MODERATION_PROVIDER: "mock" }], ["anthropic without key", { MODERATION_PROVIDER: "anthropic" }]])("still exits 1 with %s", (_n, env) => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/core-main.ts"], { cwd, env: { ...baseEnv, ...env }, encoding: "utf8", timeout: 30_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("worker.startup.refused");
  }, 40_000);
});

describe("SEC-FIN-02 production compose provisions the ledger, audit archive and ARCHIVE_DATABASE_URL", () => {
  const compose = read("docker-compose.prod.yml");
  const core = compose.slice(compose.indexOf("  worker-core:"), compose.indexOf("  worker-media:"));
  const init = compose.slice(compose.indexOf("  minio-init:"), compose.indexOf("  clamav:"));
  const names = ["S3_BUCKET_LEDGER", "S3_BUCKET_AUDIT_ARCHIVE", "ARCHIVE_DATABASE_URL", "S3_LEDGER_ACCESS_KEY_ID", "S3_LEDGER_SECRET_ACCESS_KEY", "S3_LEDGER_READ_ACCESS_KEY_ID", "S3_LEDGER_READ_SECRET_ACCESS_KEY", "S3_AUDIT_ARCHIVE_ACCESS_KEY_ID", "S3_AUDIT_ARCHIVE_SECRET_ACCESS_KEY"];
  it.each(names)("worker-core requires %s (compose :?) and .env.production.example lists it", (n) => {
    expect(core).toContain(`${n}: \${${n}:?}`);
    expect(read(".env.production.example")).toMatch(new RegExp(`^${n}=`, "m"));
  });
  it("the maintenance (retention) and erase jobs run in the core worker, which is the one holding these variables", () => {
    const main = read("apps/worker/src/core-main.ts");
    expect(main).toContain("maintenance.retention");
    expect(compose).toMatch(/worker-core:[\s\S]*WORKER_GROUPS: core/);
  });
  it("minio-init creates both object-locked buckets, keeps them private, and attaches write-only / read-only policies", () => {
    expect(init).toContain("mc mb -p --with-lock local/rp-ledger local/rp-audit-archive");
    expect(init).toContain("mc anonymous set none local/rp-ledger");
    expect(init).toMatch(/rp-ledger-w --user/);
    expect(init).toMatch(/rp-ledger-r --user/);
    expect(init).toMatch(/rp-audit-w --user/);
    expect(init).not.toMatch(/anonymous set (download|public) local\/rp-(ledger|audit)/);
  });
  it("the ledger writer policy can only PutObject; the reader can only Get/List", () => {
    const w = JSON.parse(read("infra/minio/policies/rp-ledger-w.json")).Statement.flatMap((s: { Action: string[] }) => s.Action);
    const r = JSON.parse(read("infra/minio/policies/rp-ledger-r.json")).Statement.flatMap((s: { Action: string[] }) => s.Action);
    expect(w).toEqual(["s3:PutObject"]);
    expect(r.sort()).toEqual(["s3:GetObject", "s3:ListBucket"]);
  });
  it("scripts/prod-config-check.sh passes", () => {
    const r = spawnSync("bash", ["scripts/prod-config-check.sh"], { cwd: root, encoding: "utf8" });
    expect(r.stdout).not.toContain("FAIL");
    expect(r.status).toBe(0);
  });
});
