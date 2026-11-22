import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { FakeRateLimitRedis } from "@rp/core";
import { configureRateLimit, limitProofCreate, limitReport, limitReviewEdit, limitVote } from "./ratelimit";
import { HttpError } from "./http";

// M4 gate (task #71): named assertions for P0 cases that had no named test.
const ROOT = resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const status = (p: Promise<unknown>) => p.then(() => 200, (e: HttpError) => e.status);
const retryAfter = (p: Promise<unknown>) => p.then(() => null, (e: HttpError) => (e.headers as Record<string, string> | undefined)?.["Retry-After"] ?? null);
const times = async (n: number, f: () => Promise<unknown>) => { const out: number[] = []; for (let i = 0; i < n; i++) out.push(await status(f())); return out; };

beforeEach(() => configureRateLimit(new FakeRateLimitRedis(), { RATE_LIMIT_ENABLED: true }));

describe("SEC-004 / VOT-004 vote limits", () => {
  it("VOT-004: the 61st vote write in an hour is 429 with Retry-After", async () => {
    const r = await times(61, () => limitVote("u1", null, false));
    expect(r.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(r[60]).toBe(429);
    expect(Number(await retryAfter(limitVote("u1", null, false)))).toBeGreaterThan(0);
  });
  it("VOT-004: a NEW account (< 7 d) is refused at the 21st write; another user is unaffected", async () => {
    const r = await times(21, () => limitVote("newbie", null, true));
    expect(r.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(r[20]).toBe(429);
    expect(await status(limitVote("other", null, true))).toBe(200);
  });
  it("SEC-004: 300 per hour per ipHash across users", async () => {
    let last = 200;
    for (let i = 0; i < 301; i++) last = await status(limitVote(`user${i}`, "iphash", false));
    expect(last).toBe(429);
  });
});

describe("SEC-004 report, edit and proof limits", () => {
  it("RPT-002: the 21st report in a day is 429", async () => {
    const r = await times(21, () => limitReport("u1", null));
    expect(r.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(r[20]).toBe(429);
  });
  it("RPT-002: 50 per day per ipHash", async () => {
    let last = 200;
    for (let i = 0; i < 51; i++) last = await status(limitReport(`rep${i}`, "iph"));
    expect(last).toBe(429);
  });
  it("REV-004: the 6th live edit in a day is 429", async () => {
    const r = await times(6, () => limitReviewEdit("u1"));
    expect(r.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(r[5]).toBe(429);
  });
  it("PRV-014: the 6th proof creation in a day is 429", async () => {
    const r = await times(6, () => limitProofCreate("u1"));
    expect(r.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(r[5]).toBe(429);
  });
});

describe("static pins on the M4 routes", () => {
  const routes = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? routes(p) : p.endsWith("route.ts") ? [p] : []; });
  const api = routes(join(ROOT, "apps/web/src/app/api"));
  const body = (needle: string) => api.filter((p) => p.includes(needle)).map((p) => readFileSync(p, "utf8")).join("\n");
  it("each limited M4 write route actually calls its limiter", () => {
    expect(body("vote")).toMatch(/limitVote/);
    expect(body("reports")).toMatch(/limitReport/);
    expect(body("proofs/route")).toMatch(/limitProofCreate/);
    expect(read("apps/web/src/app/api/reviews/[id]/route.ts")).toMatch(/limitReviewEdit/);
  });
  it("AZ-022 / REV-006: the public review list never selects revisions", () => {
    const pub = api.filter((p) => !/admin|\/revisions\//.test(p)).map((p) => readFileSync(p, "utf8")).join("\n");
    expect(pub).not.toMatch(/listRevisions/);
    expect(read("apps/web/src/app/api/reviews/[id]/revisions/route.ts")).toMatch(/listRevisions/);
  });
  it("RPT-007: no raw HTML sink in the web app (report details and revision bodies render escaped)", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(n) && !/\.test\./.test(n) ? [p] : []; });
    const hits = walk(join(ROOT, "apps/web/src")).filter((p) => /dangerouslySetInnerHTML|\.innerHTML\s*=/.test(readFileSync(p, "utf8")));
    expect(hits).toEqual([]);
  });
  it("RPT-007: report details never enter log or outbox statements in reports.ts", () => {
    const src = read("apps/web/src/server/reports.ts");
    expect(src).not.toMatch(/console\.|logger\./);
    for (const line of src.split("\n").filter((l) => /outboxEvent\.create|auditLog\.create/.test(l))) expect(line).not.toMatch(/details/);
  });
});

describe("PRV-017 database invariants (static pin; live raw-SQL part needs MySQL)", () => {
  const sql = read("packages/db/prisma/migrations/20261222000000_purchase_proofs/migration.sql");
  it("chk_review_verified_label keeps the three label fields all-null or all-set", () => {
    expect(sql).toMatch(/chk_review_verified_label.*verifiedPurchaseAt.*verificationMethod.*verifiedProofId/s);
  });
  it("one open proof per review, decision fields and reject reason are enforced", () => {
    for (const c of ["chk_proof_open_key", "chk_proof_decision", "chk_proof_reject_reason", "chk_proof_close"]) expect(sql).toContain(c);
  });
});

describe("PRV-023 redaction runs without network (static pin)", () => {
  it("the proof pipeline imports no network client; the default redactor is the fail-closed full mask", () => {
    const src = read("apps/worker/src/proofs.ts");
    expect(src).not.toMatch(/from "(node:)?(http|https|net|tls|dns)"|\bfetch\(|axios|undici/);
    expect(src).toMatch(/failClosedRedactor/);
  });
});

describe("break-glass (proof view)", () => {
  // QA-M4-01 (P1): fixed. getProofDetail requires and validates the reason and stores it in the audit row (behaviour test in m4.test.ts).
  it("QA-M4-01: the admin proof detail route reads the access reason server-side and audits the view", () => {
    const route = read("apps/web/src/app/api/admin/proofs/[id]/route.ts");
    expect(route + read("apps/web/src/server/proofs.ts")).toMatch(/x-access-reason|accessReason/i);
  });
});
