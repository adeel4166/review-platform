import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { FakeObjectStore } from "@rp/core";
import { processMedia, type MediaDb } from "./media";
import { createClamd, ScannerUnavailable, evaluateFreshness } from "./media/clamd";
import { healthResponse } from "./media/health";
import { StaleAlertLimiter } from "./media/clamd";
import { fakeScanner, startFakeClamd, testVerifier } from "./media/test-helpers";
import { forbiddenGroups } from "./media/verify";
import { fixtures, hasFfmpeg } from "../../../test/fixtures/media/generate";

const buckets = { ingest: "ingest", private: "private", public: "public" };

function setup(declaredMime = "image/jpeg", over: Partial<Parameters<typeof processMedia>[0]> = {}, banned: string[] = []) {
  const asset: Record<string, unknown> = { id: "a1", status: "PROCESSING", declaredMime, ingestKey: "in/a1" };
  const logs: Record<string, unknown>[] = [];
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
    mediaProcessingLog: { create: async (a) => { logs.push((a as { data: Record<string, unknown> }).data); } },
    bannedMediaHash: { findUnique: async (a) => (banned.includes((a as { where: { sha256: string } }).where.sha256) ? {} : null) },
  };
  const store = new FakeObjectStore();
  const alerts: string[] = [];
  const scanner = fakeScanner();
  return { asset, logs, store, scanner, alerts, deps: { db, store, buckets, scanner, verifier: testVerifier, alert: (k: string) => alerts.push(k), ...over } };
}
const publicKeys = (s: FakeObjectStore) => [...s.objects.keys()].filter((k) => k.startsWith("public/"));

describe("M5 media pipeline: MED fixtures (images)", () => {
  it("MED-001/002: GPS+Orientation photo -> READY in PRIVATE, scanned, sanitised, rotated, nothing public", async () => {
    const t = setup();
    const src = await fixtures.jpegWithGps();
    expect((await sharp(src).metadata()).orientation).toBe(6);
    t.store.objects.set("ingest/in/a1", src);
    expect(await processMedia(t.deps, "a1")).toBe("READY");
    expect(t.asset).toMatchObject({ status: "READY", bucket: "PRIVATE", metadataStripped: true, kind: "IMAGE" });
    expect(t.asset.virusScannedAt).toBeInstanceOf(Date);
    expect(t.asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    const medium = t.store.objects.get("private/variants/a1/medium.webp")!;
    expect(medium.includes(Buffer.from("PhoneCo"))).toBe(false);
    const m = await sharp(medium).metadata();
    expect(m.exif).toBeUndefined();
    expect(m.height).toBeGreaterThan(m.width!); // Orientation 6 applied before the tag was dropped
    expect(publicKeys(t.store)).toEqual([]);
    expect(t.store.objects.has("ingest/in/a1")).toBe(false);
  });

  it("MED-003: PNG with XMP -> READY, no XMP in outputs", async () => {
    const t = setup("image/png");
    const src = await fixtures.pngWithXmp();
    expect((await sharp(src).metadata()).xmp).toBeDefined(); // fixture really carries XMP
    t.store.objects.set("ingest/in/a1", src);
    expect(await processMedia(t.deps, "a1")).toBe("READY");
    for (const k of ["thumb", "medium"]) {
      const out = t.store.objects.get(`private/variants/a1/${k}.webp`)!;
      const m = await sharp(out).metadata();
      expect([m.xmp, m.exif, m.iptc, m.icc]).toEqual([undefined, undefined, undefined, undefined]);
    }
  });

  it("MED-005: exactly 10 MiB accepted; one byte more -> TOO_LARGE", async () => {
    const ok = setup();
    ok.store.objects.set("ingest/in/a1", await fixtures.jpegTenMiB());
    expect(await processMedia(ok.deps, "a1")).toBe("READY");
    const big = setup();
    big.store.objects.set("ingest/in/a1", Buffer.concat([await fixtures.jpegTenMiB(), Buffer.from([0])]));
    expect(await processMedia(big.deps, "a1")).toBe("FAILED");
    expect(big.asset.failureReason).toBe("TOO_LARGE");
  });

  it("MED-006: image bomb (64 MP) -> TOO_MANY_PIXELS", async () => {
    const t = setup("image/png");
    t.store.objects.set("ingest/in/a1", await fixtures.imageBomb());
    expect(await processMedia(t.deps, "a1")).toBe("FAILED");
    expect(t.asset.failureReason).toBe("TOO_MANY_PIXELS");
  });

  it.each([["jpegPlusZip"], ["jpegPlusPdf"], ["jpegPlusSvg"], ["jpegPlusPe"]] as const)("MED-007: polyglot %s -> TYPE_MISMATCH, never scanned-as-clean/READY", async (name) => {
    const t = setup();
    t.store.objects.set("ingest/in/a1", await fixtures[name]());
    expect(await processMedia(t.deps, "a1")).toBe("FAILED");
    expect(t.asset.failureReason).toBe("TYPE_MISMATCH");
    expect(t.store.objects.size).toBe(0);
  });

  it.each([["gif"], ["svg"], ["exe"], ["zip"], ["webm"]] as const)("MED-009/010/022: %s declared as JPEG -> UNSUPPORTED_TYPE", async (name) => {
    const t = setup();
    t.store.objects.set("ingest/in/a1", await fixtures[name]());
    expect(await processMedia(t.deps, "a1")).toBe("FAILED");
    expect(t.asset.failureReason).toBe("UNSUPPORTED_TYPE");
  });

  it("truncated JPEG -> CORRUPT", async () => {
    const t = setup();
    t.store.objects.set("ingest/in/a1", await fixtures.truncatedJpeg());
    expect(await processMedia(t.deps, "a1")).toBe("FAILED");
    expect(t.asset.failureReason).toBe("CORRUPT");
  });

  it("MED-014/EICAR: infected file -> FAILED MALWARE, quarantined, ingest deleted, alert, no variants, threat only in the log", async () => {
    const t = setup();
    t.store.objects.set("ingest/in/a1", await fixtures.eicar());
    expect(await processMedia(t.deps, "a1")).toBe("FAILED");
    expect(t.asset).toMatchObject({ status: "FAILED", failureReason: "MALWARE" });
    expect(t.asset.virusScannedAt).toBeUndefined();
    expect(t.store.objects.has("private/quarantine/a1")).toBe(true);
    expect(t.store.objects.has("ingest/in/a1")).toBe(false);
    expect([...t.store.objects.keys()].filter((k) => k.includes("variants"))).toEqual([]);
    expect(t.alerts).toContain("MALWARE");
    expect(JSON.stringify(t.asset)).not.toMatch(/Eicar/i);
    expect(t.logs.find((l) => l.step === "VIRUS_SCAN")).toMatchObject({ outcome: "INFECTED", engineVersion: "1.4.1", signatureVersion: "27000" });
  });

  it("MED-014: scanner unreachable -> throws (retry), asset stays PROCESSING, nothing written to private/public", async () => {
    const t = setup("image/jpeg", { scanner: fakeScanner({ fail: true }) });
    t.store.objects.set("ingest/in/a1", await fixtures.jpeg());
    await expect(processMedia(t.deps, "a1")).rejects.toBeInstanceOf(ScannerUnavailable);
    expect(t.asset.status).toBe("PROCESSING");
    expect([...t.store.objects.keys()]).toEqual(["ingest/in/a1"]);
  });

  it("MED-016: banned hash -> BANNED_HASH before the scanner runs", async () => {
    const src = await fixtures.jpeg();
    const { createHash } = await import("node:crypto");
    const t = setup("image/jpeg", {}, [createHash("sha256").update(src).digest("hex")]);
    t.store.objects.set("ingest/in/a1", src);
    expect(await processMedia(t.deps, "a1")).toBe("FAILED");
    expect(t.asset.failureReason).toBe("BANNED_HASH");
    expect(t.scanner.scans).toBe(0);
  });

  it("MED-040: object never uploaded -> NOT_CONFIRMED; wrong size -> TYPE_MISMATCH", async () => {
    const a = setup();
    expect(await processMedia(a.deps, "a1")).toBe("FAILED");
    expect(a.asset.failureReason).toBe("NOT_CONFIRMED");
    const b = setup();
    const src = await fixtures.jpeg();
    b.asset.sizeBytes = src.length + 1;
    b.store.objects.set("ingest/in/a1", src);
    expect(await processMedia(b.deps, "a1")).toBe("FAILED");
    expect(b.asset.failureReason).toBe("TYPE_MISMATCH");
  });

  it("MED-042: a variant that still carries metadata (fault injected) -> FAILED PROCESSING_ERROR + alert, never READY", async () => {
    const t = setup("image/jpeg", { verifier: async () => ["EXIF"] });
    t.store.objects.set("ingest/in/a1", await fixtures.jpeg());
    expect(await processMedia(t.deps, "a1")).toBe("FAILED");
    expect(t.asset).toMatchObject({ status: "FAILED", failureReason: "PROCESSING_ERROR" });
    expect(t.asset.bucket).toBeUndefined();
    expect([...t.store.objects.keys()].some((k) => k.startsWith("private/variants"))).toBe(false);
  });

  it("MED-041: signatures older than 72 h -> scanner unavailable (retry); 25 h -> scan proceeds with a CLAMAV_STALE alert", async () => {
    const old = setup("image/jpeg", { scanner: fakeScanner({ signatureDate: new Date(Date.now() - 73 * 3_600_000) }) });
    old.store.objects.set("ingest/in/a1", await fixtures.jpeg());
    await expect(processMedia(old.deps, "a1")).rejects.toBeInstanceOf(ScannerUnavailable);
    expect(old.asset.status).toBe("PROCESSING");
    const stale = setup("image/jpeg", { scanner: fakeScanner({ signatureDate: new Date(Date.now() - 25 * 3_600_000) }) });
    stale.store.objects.set("ingest/in/a1", await fixtures.jpeg());
    expect(await processMedia(stale.deps, "a1")).toBe("READY");
    expect(stale.alerts).toContain("CLAMAV_STALE");
  });

  it("exiftool JSON analysis flags metadata groups and ignores technical ones", () => {
    expect(forbiddenGroups(JSON.stringify([{ "System:FileName": "x", "File:FileType": "WEBP", "RIFF:ImageWidth": 1, "Composite:ImageSize": "1x1" }]))).toEqual([]);
    expect(forbiddenGroups(JSON.stringify([{ "File:FileType": "JPEG", "GPS:GPSLatitude": 1, "IFD0:Make": "x", "XMP-x:XMPToolkit": "y" }])).sort()).toEqual(["GPS", "IFD0", "XMP"]);
    expect(forbiddenGroups(JSON.stringify([{ "QuickTime:Duration": 3, "QuickTime:GPSCoordinates": "1,2" }]))).toEqual(["QuickTime"]);
  });
});

describe("INF-003 / INF-007: ClamAV over the real clamd wire protocol", () => {
  let fresh: Awaited<ReturnType<typeof startFakeClamd>>;
  let stale: Awaited<ReturnType<typeof startFakeClamd>>;
  beforeAll(async () => {
    fresh = await startFakeClamd();
    stale = await startFakeClamd({ signatureDate: new Date(Date.now() - 25 * 3_600_000) });
  });
  afterAll(async () => { await fresh.close(); await stale.close(); });

  it("zVERSION parses engine/signature version/date; zINSTREAM flags EICAR and passes a clean file", async () => {
    const c = createClamd({ host: "127.0.0.1", port: fresh.port });
    const v = await c.version();
    expect(v).toMatchObject({ engine: "1.4.1", signatureVersion: "27000" });
    expect(evaluateFreshness(v).state).toBe("ok");
    expect(await c.scan(await fixtures.jpeg())).toEqual({ clean: true });
    expect(await c.scan(await fixtures.eicar())).toMatchObject({ clean: false, threat: "Win.Test.EICAR_HDB-1" });
  });

  it("full pipeline against the clamd socket: EICAR rejected, clean photo READY", async () => {
    const scanner = createClamd({ host: "127.0.0.1", port: fresh.port });
    const bad = setup("image/jpeg", { scanner });
    bad.store.objects.set("ingest/in/a1", await fixtures.eicar());
    expect(await processMedia(bad.deps, "a1")).toBe("FAILED");
    expect(bad.asset.failureReason).toBe("MALWARE");
    const good = setup("image/jpeg", { scanner });
    good.store.objects.set("ingest/in/a1", await fixtures.jpeg());
    expect(await processMedia(good.deps, "a1")).toBe("READY");
  });

  it("INF-007: /healthz 200 when fresh; 503 clamav_stale at 25 h with one alert per 6 h; 503 clamav_unreachable when clamd is down", async () => {
    const alerts: string[] = [];
    const alert = (k: string) => alerts.push(k);
    const limiter = new StaleAlertLimiter();
    const ok = await healthResponse(createClamd({ host: "127.0.0.1", port: fresh.port }), limiter, alert);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: "ok", clamav: { engine: "1.4.1" } });
    const sc = createClamd({ host: "127.0.0.1", port: stale.port });
    const r1 = await healthResponse(sc, limiter, alert);
    const r2 = await healthResponse(sc, limiter, alert);
    expect(r1).toMatchObject({ status: 503, body: { status: "degraded", reason: "clamav_stale" } });
    expect(r2.status).toBe(503);
    expect(alerts).toEqual(["CLAMAV_STALE"]);
    const down = await healthResponse(createClamd({ host: "127.0.0.1", port: 1, timeoutMs: 500 }), limiter, alert);
    expect(down).toMatchObject({ status: 503, body: { reason: "clamav_unreachable" } });
  });
});

describe.skipIf(!(await hasFfmpeg()))("M5 video transcode (ffmpeg)", () => {
  it("MED-021: video with location/title metadata -> READY, H.264 720p MP4 + poster, metadata gone from the output", async () => {
    const t = setup("video/mp4");
    const src = await fixtures.videoWithLocation();
    expect(src.includes(Buffer.from("secret-owner"))).toBe(true);
    t.store.objects.set("ingest/in/a1", src);
    expect(await processMedia(t.deps, "a1")).toBe("READY");
    expect(t.asset).toMatchObject({ status: "READY", kind: "VIDEO", bucket: "PRIVATE", metadataStripped: true });
    const out = t.store.objects.get("private/variants/a1/video.mp4")!;
    expect(out.includes(Buffer.from("secret-owner"))).toBe(false);
    expect(out.includes(Buffer.from("PhoneCo"))).toBe(false);
    expect(out.includes(Buffer.from("40.7128"))).toBe(false);
    expect((await sharp(t.store.objects.get("private/variants/a1/thumb.webp")!).metadata()).format).toBe("webp");
    expect(publicKeys(t.store)).toEqual([]);
  }, 60_000);

  it("MED-017: 30 s passes, 31 s -> TOO_LONG", async () => {
    const ok = setup("video/mp4");
    ok.store.objects.set("ingest/in/a1", await fixtures.video30s());
    expect(await processMedia(ok.deps, "a1")).toBe("READY");
    const long = setup("video/mp4");
    long.store.objects.set("ingest/in/a1", await fixtures.video31s());
    expect(await processMedia(long.deps, "a1")).toBe("FAILED");
    expect(long.asset.failureReason).toBe("TOO_LONG");
  }, 120_000);

  it("MED-019: two video streams -> UNSUPPORTED_CODEC", async () => {
    const t = setup("video/mp4");
    t.store.objects.set("ingest/in/a1", await fixtures.videoTwoStreams());
    expect(await processMedia(t.deps, "a1")).toBe("FAILED");
    expect(t.asset.failureReason).toBe("UNSUPPORTED_CODEC");
  }, 60_000);

  it("EICAR inside an MP4 container is scanned before any transcode runs", async () => {
    const t = setup("video/mp4");
    const mp4 = await fixtures.videoWithLocation();
    t.store.objects.set("ingest/in/a1", Buffer.concat([mp4, Buffer.from((await import("../../../test/fixtures/media/generate")).EICAR)]));
    expect(await processMedia(t.deps, "a1")).toBe("FAILED");
    expect(t.asset.failureReason).toBe("MALWARE");
  }, 60_000);
});
