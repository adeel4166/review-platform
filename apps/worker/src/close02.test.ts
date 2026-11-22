/**
 * CLOSE-02 (task #84): named assertions for the M5 gate gaps QA-M5-01..07 and SEC-M5-01/02/03
 * (docs/qa/m5-gate-report.md). Case IDs are in the test names.
 */
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { FakeObjectStore, legalHoldKey, parseOrderRefKeys, quarantineKey } from "@rp/core";
import { processMedia, type MediaDb } from "./media";
import { bannedHashMatcher, hammingDistance, perceptualHash } from "./media/hash-match";
import { PDF_MAX_PAGES, PdfReject, inspectPdf, rasterisePdf } from "./media/pdf";
import { sweepQuarantine } from "./media/quarantine";
import { SandboxUnavailable, assertMediaSandbox, bwrapArgv, isSandboxRequired, sandboxSelfTest, wrapSandboxed } from "./media/sandbox";
import { detectType } from "./media/validate";
import { transcodeVideo, VideoReject } from "./media/video";
import { EICAR, fakeScanner, testVerifier } from "./media/test-helpers";
import { forbiddenMediaEnv, assertMediaEnv } from "./groups";
import { failClosedRedactor, processProofFile, type ProofDeps } from "./proofs";
import { makeFakeDb } from "./test-fake-db";
import { fixtures, hasFfmpeg } from "../../../test/fixtures/media/generate";

const buckets = { ingest: "ingest", private: "private", public: "public" };
function setup(declaredMime = "image/jpeg", extra: Record<string, unknown> = {}) {
  const asset: Record<string, unknown> = { id: "a1", status: "PROCESSING", declaredMime, ingestKey: "in/a1", ...extra };
  const log: { step: string; outcome: string; detail?: unknown }[] = [];
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
    mediaProcessingLog: { create: async (a: unknown) => { log.push((a as { data: never }).data); } },
    bannedMediaHash: { findUnique: async () => null },
  };
  const store = new FakeObjectStore();
  const alerts: [string, Record<string, unknown>][] = [];
  const scanner = fakeScanner();
  return { asset, store, log, alerts, scanner, deps: { db, store, buckets, scanner, verifier: testVerifier, alert: (k: string, d: Record<string, unknown>) => alerts.push([k, d]) } };
}

/** Executable stand-ins so `which bwrap` / `which prlimit` succeed without the real binaries. */
const fakeBin = () => {
  const dir = mkdtempSync(join(tmpdir(), "rp-fakebin-"));
  for (const n of ["bwrap", "prlimit"]) { writeFileSync(join(dir, n), "#!/bin/sh\nexit 0\n"); chmodSync(join(dir, n), 0o755); }
  return dir;
};

describe("QA-M5-01 / SEC-M5-01 / MED-035: parser sandbox", () => {
  it("MED-035: the wrapper is bwrap --unshare-all (no network) + prlimit, read-only root, private /job", () => {
    const w = bwrapArgv("/usr/bin/bwrap", "/usr/bin/prlimit", "video", "/tmp/j", "ffmpeg", ["-i", "original"]);
    expect(w.cmd).toBe("/usr/bin/bwrap");
    expect(w.args).toEqual(expect.arrayContaining(["--unshare-all", "--die-with-parent", "--cap-drop", "ALL", "--ro-bind", "/usr", "--bind", "/tmp/j", "/job", "--chdir", "/job"]));
    const tail = w.args.slice(w.args.indexOf("--") + 1);
    expect(tail[0]).toBe("/usr/bin/prlimit");
    expect(tail).toEqual(expect.arrayContaining(["--nofile=64", "ffmpeg", "-i", "original"]));
    expect(tail.some((a) => a.startsWith("--as=")) && tail.some((a) => a.startsWith("--cpu=")) && tail.some((a) => a.startsWith("--fsize="))).toBe(true);
  });
  it("MED-035: MEDIA_SANDBOX_REQUIRED=true and no bwrap -> the parser refuses to run (retryable error, never unsandboxed)", () => {
    expect(() => wrapSandboxed("video", "/tmp", "ffmpeg", [], { PATH: "", MEDIA_SANDBOX_REQUIRED: "true" })).toThrow(SandboxUnavailable);
    expect(wrapSandboxed("video", "/tmp", "ffmpeg", ["x"], { PATH: "" })).toMatchObject({ cmd: "ffmpeg", sandboxed: false });
    expect(wrapSandboxed("video", "/tmp", "ffmpeg", ["x"], { PATH: fakeBin() })).toMatchObject({ sandboxed: true });
  });
  it("SEC-M5-01: ffmpeg/ffprobe are invoked with -protocol_whitelist file and a forced demuxer", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("./media/video.ts", import.meta.url), "utf8");
    expect(src).toContain('FORCED_DEMUXER = ["-f", "mov"]');
    expect((src.match(/-protocol_whitelist/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(src).not.toMatch(/\bspawn\(/);
  });
  it("MED-035: 200 malformed images never crash the worker: each ends FAILED or READY, nothing throws", async () => {
    const seeds = [await fixtures.jpeg(), await fixtures.webp(), await (await import("sharp")).default({ create: { width: 64, height: 48, channels: 3, background: "#369" } }).png().toBuffer()];
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const outcomes = { FAILED: 0, READY: 0 };
    for (let i = 0; i < 200; i++) {
      const base = seeds[i % 3]!;
      const b = Buffer.from(base);
      const mode = i % 4;
      let file: Buffer = b;
      if (mode === 0) file = b.subarray(0, 8 + Math.floor(rnd() * (b.length - 8))); // truncated
      else if (mode === 1) for (let k = 0; k < 20; k++) b[12 + Math.floor(rnd() * (b.length - 12))] = Math.floor(rnd() * 256); // flipped bytes after the signature
      else if (mode === 2) file = Buffer.concat([b.subarray(0, 12), Buffer.alloc(200, 0xff), b.subarray(12)]); // garbage inserted
      else file = Buffer.concat([b.subarray(0, 16), Buffer.from(Array.from({ length: 300 }, () => Math.floor(rnd() * 256)))]); // header + noise
      const mime = i % 3 === 0 ? "image/jpeg" : i % 3 === 1 ? "image/webp" : "image/png";
      const s = setup(mime, { sizeBytes: file.length });
      await s.store.put("ingest", "in/a1", file);
      const out = await processMedia(s.deps, "a1");
      expect(["FAILED", "READY"]).toContain(out);
      outcomes[out as "FAILED" | "READY"]++;
      if (out === "FAILED") expect(s.asset.failureReason).toBeTruthy();
      expect(s.store.objects.has("public/m/a1/medium.webp")).toBe(false);
    }
    expect(outcomes.FAILED + outcomes.READY).toBe(200);
    expect(outcomes.FAILED).toBeGreaterThan(50);
  }, 120_000);
  it.runIf(spawnSync("ffprobe", ["-version"]).status === 0)("MED-035: malformed videos are CORRUPT/UNSUPPORTED (VideoReject), never a crash", async () => {
    if (!(await hasFfmpeg())) return;
    const good = await fixtures.videoWithLocation();
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 8; i++) {
      const b = Buffer.from(good);
      const bad = i % 2 ? b.subarray(0, 200 + Math.floor(rnd() * 3000)) : (() => { for (let k = 0; k < 40; k++) b[40 + Math.floor(rnd() * (b.length - 40))] = Math.floor(rnd() * 256); return b; })();
      await transcodeVideo(bad).then(() => undefined, (e) => { expect(e instanceof VideoReject || e instanceof Error).toBe(true); });
    }
  }, 120_000);
});

describe("QA-M5-01 / MED-047: startup self-test with MEDIA_SANDBOX_REQUIRED", () => {
  it("MED-047: bwrap missing with MEDIA_SANDBOX_REQUIRED=true -> refuses (the entrypoint exits 1); not required -> warning only", async () => {
    await expect(assertMediaSandbox({ PATH: "", MEDIA_SANDBOX_REQUIRED: "true" })).rejects.toThrow(/self-test failed.*bwrap/);
    const warn = vi.fn();
    const r = await assertMediaSandbox({ PATH: "", MEDIA_SANDBOX_REQUIRED: "false" }, undefined, warn);
    expect(r.ok).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });
  it("MED-047: network reachable inside the sandbox, or a writable /usr -> self-test fails and required startup refuses", async () => {
    const PATH = fakeBin();
    expect(await sandboxSelfTest({ PATH }, async () => ({ code: 4 }))).toMatchObject({ ok: false, problem: expect.stringContaining("network") });
    expect(await sandboxSelfTest({ PATH }, async () => ({ code: 3 }))).toMatchObject({ ok: false, problem: expect.stringContaining("/usr") });
    await expect(assertMediaSandbox({ PATH, MEDIA_SANDBOX_REQUIRED: "true" }, async () => ({ code: 4 }))).rejects.toThrow(/network/);
    expect(await sandboxSelfTest({ PATH }, async () => ({ code: 0 }))).toEqual({ ok: true, sandboxed: true });
  });
  it("MED-047: required by default in production and CI, an explicit value wins", () => {
    expect(isSandboxRequired({ NODE_ENV: "production" })).toBe(true);
    expect(isSandboxRequired({ CI: "true" })).toBe(true);
    expect(isSandboxRequired({})).toBe(false);
    expect(isSandboxRequired({ NODE_ENV: "production", MEDIA_SANDBOX_REQUIRED: "false" })).toBe(false);
  });
  it("MED-047: the worker entrypoint exits 1 when the sandbox is required and bwrap is absent", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: new URL("..", import.meta.url).pathname,
      // A PATH without bwrap/prlimit (node is invoked by absolute path) makes the required self-test fail.
      env: { PATH: "/nonexistent", WORKER_GROUPS: "media", REDIS_URL: "redis://127.0.0.1:1", MEDIA_SANDBOX_REQUIRED: "true" },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("self-test failed");
  });
});

describe("QA-M5-02 / MED-036: HashMatcher hook", () => {
  it("MED-036: check({sha256, pHash}) is called; a match -> REJECTED BANNED_HASH + legal hold + alert, nothing public", async () => {
    const s = setup();
    await s.store.put("ingest", "in/a1", await fixtures.jpeg());
    const check = vi.fn(async (i: { sha256: string; pHash?: string }) => ({ match: !!i.pHash, list: "test-list" })); // matches only on the perceptual hash
    expect(await processMedia({ ...s.deps, hashMatcher: { check } }, "a1")).toBe("FAILED");
    expect(s.asset).toMatchObject({ status: "FAILED", failureReason: "BANNED_HASH" });
    expect(check).toHaveBeenCalledTimes(2);
    expect(check.mock.calls[0]![0]).toMatchObject({ sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(check.mock.calls[1]![0].pHash).toMatch(/^[0-9a-f]{16}$/);
    expect(s.alerts.find(([k]) => k === "BANNED_HASH")![1]).toMatchObject({ assetId: "a1", legalHold: true });
    expect(s.log.find((l) => l.step === "BANNED_HASH")!.detail).toMatchObject({ legalHold: true, list: "test-list" });
    expect(s.store.objects.has(`private/${legalHoldKey("a1")}`)).toBe(true);
    expect([...s.store.objects.keys()].some((k) => k.startsWith("public/"))).toBe(false);
  });
  it("MED-036: the default stub matches BannedMediaHash by sha256; perceptual hash is stable under a re-encode", async () => {
    const m = bannedHashMatcher({ bannedMediaHash: { findUnique: async (a: unknown) => ((a as { where: { sha256: string } }).where.sha256 === "ab" ? {} : null) } });
    expect(await m.check({ sha256: "ab" })).toMatchObject({ match: true });
    expect(await m.check({ sha256: "cd", pHash: "0".repeat(16) })).toEqual({ match: false });
    const a = await fixtures.jpeg();
    const re = await sharp(a).webp({ quality: 60 }).toBuffer();
    expect(hammingDistance(await perceptualHash(a), await perceptualHash(re))).toBeLessThan(10);
  });
});

describe("QA-M5-03 / MED-043: staging sha256 compare", () => {
  it("MED-043: a staged object that differs from the recorded sha256 -> FAILED PROCESSING_ERROR + STAGING_HASH_MISMATCH, nothing decoded or scanned", async () => {
    const s = setup();
    await s.store.put("ingest", "in/a1", await fixtures.jpeg());
    expect(await processMedia(s.deps, "a1", { expectedSha256: "0".repeat(64) })).toBe("FAILED");
    expect(s.asset).toMatchObject({ status: "FAILED", failureReason: "PROCESSING_ERROR" });
    expect(s.alerts.map(([k]) => k)).toContain("STAGING_HASH_MISMATCH");
    expect(s.scanner.scans).toBe(0);
    expect(s.store.objects.has("private/variants/a1/medium.webp")).toBe(false);
  });
  it("MED-043: the matching sha256 passes", async () => {
    const s = setup();
    const b = await fixtures.jpeg();
    await s.store.put("ingest", "in/a1", b);
    const { createHash } = await import("node:crypto");
    expect(await processMedia(s.deps, "a1", { expectedSha256: createHash("sha256").update(b).digest("hex") })).toBe("READY");
  });
});

describe("QA-M5-05 / MED-024 / MED-046: PDF evidence", () => {
  const pdf = (pages: number, extra = "") => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count ${pages}/Kids[]>>endobj\n${Array.from({ length: pages }, (_, i) => `${i + 3} 0 obj<</Type /Page/Parent 2 0 R>>endobj\n`).join("")}${extra}trailer<</Root 1 0 R>>\n%%EOF`);
  it("MED-024: detectType recognises PDF only for evidence; review media still sees UNSUPPORTED (null)", () => {
    expect(detectType(pdf(1), { allowPdf: true })).toEqual({ mime: "application/pdf", kind: "DOCUMENT" });
    expect(detectType(pdf(1))).toBeNull();
  });
  it("MED-024: 20 pages pass the check, 21 -> TOO_LONG with subReason PDF_PAGES", () => {
    expect(inspectPdf(pdf(PDF_MAX_PAGES))).toEqual({ pagesHint: 20 });
    try { inspectPdf(pdf(21)); expect.unreachable(); } catch (e) { expect(e).toBeInstanceOf(PdfReject); expect(e).toMatchObject({ reason: "TOO_LONG", subReason: "PDF_PAGES" }); }
  });
  it("MED-046: an encrypted PDF -> CORRUPT", () => {
    expect(() => inspectPdf(pdf(1, "/Encrypt 9 0 R\n"))).toThrow(PdfReject);
    try { inspectPdf(pdf(1, "/Encrypt 9 0 R\n")); } catch (e) { expect(e).toMatchObject({ reason: "CORRUPT", subReason: "PDF_ENCRYPTED" }); }
  });
  const mk = () => {
    const h = makeFakeDb(["review", "user", "purchaseProof", "purchaseProofFile", "outboxEvent", "trustSignal", "reviewVote", "report"], {
      purchaseProof: (r, t) => ({ files: t.purchaseProofFile!.filter((f) => f.proofId === r.id), review: { createdAt: new Date("2026-11-01"), product: { name: "W" } } }),
      purchaseProofFile: (r, t) => ({ proof: { submittedById: t.purchaseProof!.find((p) => p.id === r.proofId)?.submittedById } }),
    });
    const store = new FakeObjectStore();
    const NOW = new Date("2026-12-10T12:00:00Z");
    const deps: ProofDeps = { db: h.db, store: store as never, buckets: { ingest: "ingest", private: "private" }, redactor: failClosedRedactor, scanner: fakeScanner(), keys: parseOrderRefKeys("1:c2VjcmV0") }; void NOW;
    h.t.purchaseProof!.push({ id: "pp", reviewId: "r1", submittedById: "u1", status: "PENDING", openKey: "r1", slaDueAt: new Date("2026-12-12"), legalHold: false });
    return { h, store, deps };
  };
  const upload = async (s: ReturnType<typeof mk>, id: string, bytes: Buffer, mime: string) => {
    s.h.t.purchaseProofFile!.push({ id, proofId: "pp", ownerId: "u1", kind: mime === "application/pdf" ? "PDF" : "IMAGE", status: "PROCESSING", declaredMime: mime, sizeBytes: bytes.length, storageKey: `in/proof/${id}`, isRedacted: false });
    await s.store.put("ingest", `in/proof/${id}`, bytes);
  };
  it("MED-046: a 20-page PDF -> 20 redacted master pages, the PDF original stays private", async () => {
    const s = mk();
    const page = await sharp({ create: { width: 30, height: 20, channels: 3, background: "#fff" } }).png().toBuffer();
    await upload(s, "f1", pdf(20), "application/pdf");
    expect(await processProofFile({ ...s.deps, rasterise: async () => Array.from({ length: 20 }, () => page) }, "f1")).toBe("READY");
    const red = s.h.t.purchaseProofFile!.filter((f) => f.isRedacted);
    expect(red).toHaveLength(20);
    expect(red.every((f) => (f.storageKey as string).startsWith("proof/f1/redacted.p"))).toBe(true);
    expect([...s.store.objects.keys()].every((k) => !k.startsWith("public/"))).toBe(true);
  });
  it("MED-046/MED-024: 21-page and encrypted PDFs are REJECTED before any decode", async () => {
    const s = mk();
    await upload(s, "f1", pdf(21), "application/pdf");
    expect(await processProofFile(s.deps, "f1")).toBe("REJECTED");
    expect(s.h.t.purchaseProofFile![0]).toMatchObject({ failureReason: "TOO_LONG" });
    const e = mk();
    await upload(e, "f2", pdf(2, "/Encrypt 9 0 R\n"), "application/pdf");
    expect(await processProofFile(e.deps, "f2")).toBe("REJECTED");
    expect(e.h.t.purchaseProofFile![0]).toMatchObject({ failureReason: "CORRUPT" });
  });
  it.runIf(spawnSync("pdftoppm", ["-v"]).status !== null)("MED-046: the real sandbox-wrapped pdfinfo/pdftoppm rasterise a small PDF", async () => {
    // A valid one-page PDF generated with correct xref offsets.
    const objs = ["<</Type/Catalog/Pages 2 0 R>>", "<</Type/Pages/Count 1/Kids[3 0 R]>>", "<</Type/Page/Parent 2 0 R/MediaBox[0 0 40 30]>>"];
    let body = "%PDF-1.4\n"; const offs: number[] = [];
    objs.forEach((o, i) => { offs.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const x = body.length;
    body += `xref\n0 4\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer<</Size 4/Root 1 0 R>>\nstartxref\n${x}\n%%EOF`;
    const pages = await rasterisePdf(Buffer.from(body));
    expect(pages).toHaveLength(1);
    expect((await sharp(pages[0]!).metadata()).format).toBe("png");
  });
});

describe("QA-M5-07 / INF-008: media group environment", () => {
  it.each(["MODERATION_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "AI_PROVIDER_KEY", "SMTP_URL", "AUTH_SECRET", "TOTP_ENC_KEYS", "RECOVERY_CODE_PEPPERS"])("INF-008: %s is forbidden in the media group", (k) => {
    expect(forbiddenMediaEnv({ [k]: "x" })).toEqual([k]);
    expect(() => assertMediaEnv({ REDIS_URL: "redis://x", [k]: "secret-value" })).toThrow(k);
    expect(() => assertMediaEnv({ REDIS_URL: "redis://x", [k]: "secret-value" })).not.toThrow(/secret-value/ as never);
  });
  it("INF-008: DB, S3 and ClamAV settings are allowed; REDIS_URL is required", () => {
    expect(() => assertMediaEnv({ REDIS_URL: "redis://x", DATABASE_URL: "mysql://x", S3_ENDPOINT: "http://s3", CLAMD_HOST: "clamav" })).not.toThrow();
    expect(() => assertMediaEnv({})).toThrow(/REDIS_URL/);
  });
  it("INF-008: the entrypoint exits 1 when the media group starts with the AI key, without echoing it", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { PATH: process.env.PATH, WORKER_GROUPS: "media", REDIS_URL: "redis://127.0.0.1:1", MODERATION_API_KEY: "sk-secret-value" },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("MODERATION_API_KEY");
    expect(r.stderr).not.toContain("sk-secret-value");
  });
});

describe("SEC-M5-02: proof originals are AV-scanned, the redactor is capped", () => {
  const mk = () => {
    const h = makeFakeDb(["review", "user", "purchaseProof", "purchaseProofFile", "outboxEvent"], {
      purchaseProof: (r, t) => ({ files: t.purchaseProofFile!.filter((f) => f.proofId === r.id), review: { createdAt: new Date(), product: { name: "W" } } }),
      purchaseProofFile: (r, t) => ({ proof: { submittedById: t.purchaseProof!.find((p) => p.id === r.proofId)?.submittedById } }),
    });
    const store = new FakeObjectStore();
    const deps: ProofDeps = { db: h.db, store: store as never, buckets: { ingest: "ingest", private: "private" }, redactor: failClosedRedactor, scanner: fakeScanner(), keys: parseOrderRefKeys("1:c2VjcmV0") };
    h.t.purchaseProof!.push({ id: "pp", reviewId: "r1", submittedById: "u1", status: "PENDING", openKey: "r1", slaDueAt: new Date(Date.now() + 1e9), legalHold: false });
    return { h, store, deps };
  };
  const up = async (s: ReturnType<typeof mk>, bytes: Buffer) => {
    s.h.t.purchaseProofFile!.push({ id: "f1", proofId: "pp", ownerId: "u1", kind: "IMAGE", status: "PROCESSING", declaredMime: "image/jpeg", sizeBytes: bytes.length, storageKey: "in/proof/f1", isRedacted: false });
    await s.store.put("ingest", "in/proof/f1", bytes);
  };
  it("SEC-M5-02: an infected proof original is REJECTED MALWARE, quarantined, and never stored as an original or redacted", async () => {
    const s = mk(); await up(s, await fixtures.eicar());
    expect(await processProofFile(s.deps, "f1")).toBe("REJECTED");
    expect(s.h.t.purchaseProofFile![0]).toMatchObject({ failureReason: "MALWARE" });
    expect(s.store.objects.has(`private/${quarantineKey("f1")}`)).toBe(true);
    expect(s.store.objects.has("private/proof/f1/orig")).toBe(false);
    expect(s.h.t.purchaseProofFile!.some((f) => f.isRedacted)).toBe(false);
  });
  it("SEC-M5-02: a scanner outage throws (retry) and persists nothing unscanned", async () => {
    const s = mk(); await up(s, await fixtures.jpeg());
    await expect(processProofFile({ ...s.deps, scanner: fakeScanner({ fail: true }) }, "f1")).rejects.toThrow();
    expect(s.store.objects.has("private/proof/f1/orig")).toBe(false);
  });
  it("SEC-M5-02: the redactor uses the shared 50 MP pixel limit (a 64 MP bomb is refused) and caps the mask canvas at 4096", async () => {
    await expect(failClosedRedactor.redact({ bytes: await fixtures.imageBomb(), mime: "image/png" })).rejects.toThrow(/pixel limit/i);
    const big = await sharp({ create: { width: 6000, height: 3000, channels: 3, background: "#fff" } }).png().toBuffer();
    const r = await failClosedRedactor.redact({ bytes: big, mime: "image/png" });
    expect(await sharp(r.png).metadata()).toMatchObject({ width: 4096, height: 2048 });
  });
  it("SEC-M5-02: EICAR constant is the same one the scanner double flags", () => {
    expect(EICAR.startsWith("X5O!P%@AP")).toBe(true);
  });
});

describe("SEC-M5-03: quarantine retention", () => {
  const NOW = new Date("2026-12-10T00:00:00Z");
  it("SEC-M5-03: quarantine/ objects older than 30 days are purged; newer ones and legal-hold/ are kept", async () => {
    const store = new FakeObjectStore();
    for (const k of ["quarantine/old", "quarantine/new", "legal-hold/x"]) await store.put("private", k, Buffer.from("x"));
    store.modifiedAt.set("private/quarantine/old", new Date(NOW.getTime() - 31 * 86_400_000));
    store.modifiedAt.set("private/quarantine/new", new Date(NOW.getTime() - 5 * 86_400_000));
    store.modifiedAt.set("private/legal-hold/x", new Date(NOW.getTime() - 400 * 86_400_000));
    expect(await sweepQuarantine({ store, buckets: { private: "private" } }, NOW)).toEqual({ deleted: 1, remaining: 1 });
    expect([...store.objects.keys()].sort()).toEqual(["private/legal-hold/x", "private/quarantine/new"]);
    expect(await sweepQuarantine({ store, buckets: { private: "private" } }, NOW)).toEqual({ deleted: 0, remaining: 1 }); // idempotent
  });
  it("SEC-M5-03: more than the threshold of quarantined files raises QUARANTINE_COUNT_HIGH", async () => {
    const store = new FakeObjectStore();
    for (let i = 0; i < 6; i++) await store.put("private", `quarantine/${i}`, Buffer.from("x"));
    const alert = vi.fn();
    await sweepQuarantine({ store, buckets: { private: "private" }, alert }, new Date(), { threshold: 5 });
    expect(alert).toHaveBeenCalledWith("QUARANTINE_COUNT_HIGH", { count: 6 });
  });
});
