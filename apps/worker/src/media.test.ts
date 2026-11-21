import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { FakeObjectStore } from "@rp/core";
import { processMedia, type MediaDb } from "./media";

const buckets = { ingest: "ingest", private: "private" };

function setup(declaredMime = "image/jpeg") {
  const asset = { id: "a1", status: "PROCESSING", declaredMime, ingestKey: "in/a1" } as Record<string, unknown>;
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
  };
  const store = new FakeObjectStore();
  return { asset, db, store, deps: { db, store, buckets } };
}

/** A JPEG carrying EXIF (camera info + GPS), as a phone photo would. */
const jpegWithExif = () =>
  sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#c33" } })
    .withExif({ IFD0: { Copyright: "secret-owner", Make: "PhoneCo" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 26/1 46/1" } })
    .jpeg()
    .toBuffer();

describe("processMedia", () => {
  it("strips EXIF/GPS, writes thumb+medium variants, marks READY and deletes the original", async () => {
    const { asset, store, deps } = setup();
    const original = await jpegWithExif();
    expect((await sharp(original).metadata()).exif).toBeDefined(); // fixture really has EXIF
    expect(original.includes(Buffer.from("secret-owner"))).toBe(true);
    store.objects.set("ingest/in/a1", original);

    expect(await processMedia(deps, "a1")).toBe("READY");
    expect(asset.status).toBe("READY");
    const thumb = store.objects.get("private/variants/a1/thumb.webp")!;
    const medium = store.objects.get("private/variants/a1/medium.webp")!;
    for (const out of [thumb, medium]) {
      const m = await sharp(out).metadata();
      expect(m.format).toBe("webp");
      expect(m.exif).toBeUndefined();
      expect(out.includes(Buffer.from("secret-owner"))).toBe(false);
      expect(out.includes(Buffer.from("PhoneCo"))).toBe(false);
    }
    expect((await sharp(thumb).metadata()).width).toBe(256);
    expect((await sharp(medium).metadata()).width).toBe(1024);
    expect(store.objects.has("ingest/in/a1")).toBe(false);
  });

  it("fails a file whose content is not the declared image type", async () => {
    const { asset, store, deps } = setup("image/png");
    store.objects.set("ingest/in/a1", await jpegWithExif());
    expect(await processMedia(deps, "a1")).toBe("FAILED");
    expect(asset).toMatchObject({ status: "FAILED", failureReason: "TYPE_MISMATCH" });
    expect(store.objects.size).toBe(0);
  });

  it("fails non-images disguised with an image type (MIME checked by content)", async () => {
    const { asset, store, deps } = setup("image/jpeg");
    store.objects.set("ingest/in/a1", Buffer.from("<svg onload=alert(1)></svg>"));
    expect(await processMedia(deps, "a1")).toBe("FAILED");
    expect(asset.failureReason).toBe("UNSUPPORTED_TYPE");
  });

  it("fails corrupt images and oversize objects", async () => {
    const c = setup();
    c.store.objects.set("ingest/in/a1", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(50, 1)]));
    expect(await processMedia(c.deps, "a1")).toBe("FAILED");
    expect(c.asset.failureReason).toBe("CORRUPT");

    const big = setup();
    big.store.objects.set("ingest/in/a1", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(10 * 1024 * 1024)]));
    expect(await processMedia(big.deps, "a1")).toBe("FAILED");
    expect(big.asset.failureReason).toBe("TOO_LARGE");
  });

  it("fails when the uploaded object is missing", async () => {
    const { asset, deps } = setup();
    expect(await processMedia(deps, "a1")).toBe("FAILED");
    expect(asset.failureReason).toBe("MISSING_OBJECT");
  });

  it("is idempotent: non-PROCESSING assets are skipped; storage errors throw for retry", async () => {
    const s = setup();
    s.asset.status = "READY";
    expect(await processMedia(s.deps, "a1")).toBe("SKIPPED");
    const t = setup();
    t.store.get = async () => { throw new Error("S3 down"); };
    await expect(processMedia(t.deps, "a1")).rejects.toThrow("S3 down");
    expect(t.asset.status).toBe("PROCESSING");
  });
});
