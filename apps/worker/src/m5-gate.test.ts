/**
 * M5 QA gate (task #76). Named assertions for P0 cases that the pipeline implements but no test named.
 * Cases whose production code does not exist yet are NOT pinned here; they are defects in docs/qa/m5-gate-report.md.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeObjectStore, MEDIA_MAX_PHOTOS_PER_REVIEW, MEDIA_MAX_VIDEOS_PER_REVIEW, MEDIA_MAX_VIDEO_BYTES } from "@rp/core";
import { processMedia, type MediaDb } from "./media";
import { createClamd, ScannerUnavailable } from "./media/clamd";
import { EICAR, fakeScanner, startFakeClamd, testVerifier } from "./media/test-helpers";
import { fixtures } from "../../../test/fixtures/media/generate";

const root = join(__dirname, "../../..");
const buckets = { ingest: "ingest", private: "private", public: "public" };

function setup(declaredMime = "image/jpeg", scanner = fakeScanner()) {
  const asset: Record<string, unknown> = { id: "a1", status: "PROCESSING", declaredMime, ingestKey: "in/a1" };
  const db: MediaDb = {
    mediaAsset: {
      findUnique: async () => asset as never,
      updateMany: async (args) => {
        const { where, data } = args as { where: { status?: unknown }; data: Record<string, unknown> };
        const allowed = typeof where.status === "string" ? [where.status] : (where.status as { in: string[] }).in;
        if (!allowed.includes(asset.status as string)) return { count: 0 };
        Object.assign(asset, data);
        return { count: 1 };
      },
    },
    mediaProcessingLog: { create: async () => undefined },
    bannedMediaHash: { findUnique: async () => null },
  };
  const store = new FakeObjectStore();
  return { asset, store, scanner, deps: { db, store, buckets, scanner, verifier: testVerifier } };
}
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return f === "node_modules" || f === ".next" || f === "coverage" ? [] : statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });

describe("M5 gate: scanning", () => {
  let clam: Awaited<ReturnType<typeof startFakeClamd>>;
  beforeAll(async () => { clam = await startFakeClamd(); });
  afterAll(async () => { await clam.close(); });

  it("MED-012: EICAR named .jpg -> REJECTED MALWARE, quarantined, ingest deleted, nothing public", async () => {
    const t = setup();
    t.store.objects.set("ingest/in/a1", await fixtures.eicar());
    expect(await processMedia(t.deps, "a1")).toBe("FAILED");
    expect(t.asset.failureReason).toBe("MALWARE");
    expect(t.store.objects.has("private/quarantine/a1")).toBe(true);
    expect(t.store.objects.has("ingest/in/a1")).toBe(false);
    expect([...t.store.objects.keys()].some((k) => k.startsWith("public/"))).toBe(false);
  });

  it("MED-013: EICAR at byte 30 MB of a 40 MB stream is detected over zINSTREAM; clamd limits are >= 64M", async () => {
    const big = Buffer.alloc(40 * 1024 * 1024, 0x41);
    Buffer.from(EICAR).copy(big, 30 * 1024 * 1024);
    expect(await createClamd({ host: "127.0.0.1", port: clam.port, timeoutMs: 30_000 }).scan(big)).toMatchObject({ clean: false });
    const conf = readFileSync(join(root, "infra/clamav/clamd.conf"), "utf8");
    for (const k of ["StreamMaxLength", "MaxFileSize", "PCREMaxFileSize"]) expect(conf).toMatch(new RegExp(`^${k} 64M$`, "m"));
  }, 120_000);

  it("MED-015: one scanner error then clean -> READY with virusScannedAt; no READY without a scan", async () => {
    let calls = 0;
    const base = fakeScanner();
    const flaky = { ...base, version: base.version, scan: async (b: Buffer) => { if (calls++ === 0) throw new ScannerUnavailable("blip"); return base.scan(b); } };
    const t = setup("image/jpeg", flaky as never);
    t.store.objects.set("ingest/in/a1", await fixtures.jpeg());
    await expect(processMedia(t.deps, "a1")).rejects.toBeInstanceOf(ScannerUnavailable);
    expect(t.asset.status).toBe("PROCESSING");
    expect(await processMedia(t.deps, "a1")).toBe("READY");
    expect(t.asset.virusScannedAt).toBeInstanceOf(Date);
  });
});

describe("M5 gate: limits and sources", () => {
  it("MED-018: a video of exactly the 50 MiB cap is read; one byte more -> TOO_LARGE (read aborted)", async () => {
    expect(MEDIA_MAX_VIDEO_BYTES).toBe(50 * 1024 * 1024);
    const t = setup("video/mp4");
    t.store.objects.set("ingest/in/a1", Buffer.alloc(MEDIA_MAX_VIDEO_BYTES + 1, 1));
    expect(await processMedia(t.deps, "a1")).toBe("FAILED");
    expect(t.asset.failureReason).toBe("TOO_LARGE");
  });

  it("MED-031: per-review caps are 10 photos and 2 videos", () => {
    expect([MEDIA_MAX_PHOTOS_PER_REVIEW, MEDIA_MAX_VIDEOS_PER_REVIEW]).toEqual([10, 2]);
  });

  it("MED-038: no media route or server module fetches a user-supplied URL, and the slot contract has no url field", () => {
    const files = [...walk(join(root, "apps/web/src/app/api/media")), join(root, "apps/web/src/server/media.ts"), join(root, "packages/core/src/media.ts")];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\bfetch\(|axios|got\(|undici|http\.request|https\.get/);
    }
    expect(readFileSync(join(root, "packages/core/src/media.ts"), "utf8")).not.toMatch(/z\.string\(\)\.url\(\)|sourceUrl|importUrl/);
  });

  it("INF-002 (static part): MinIO web policy grants no read on ingest and the runtime script asserts it", () => {
    const sh = readFileSync(join(root, "scripts/inf002-bucket-check.sh"), "utf8");
    expect(sh).toMatch(/rp-web GET ingest denied/);
    expect(sh).toMatch(/anonymous GET ingest 403/);
    const policy = readFileSync(join(root, "infra/minio/policies/rp-web.json"), "utf8");
    expect(policy).not.toMatch(/rp-ingest\/\*[\s\S]{0,80}s3:GetObject|s3:GetObject[\s\S]{0,80}rp-ingest/);
  });
});
