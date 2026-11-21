import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { FakeObjectStore } from "@rp/core";
import { processMedia, type MediaDb } from "./media";

// SEC-08(c) / MED-039: a GPS-tagged photo must come out of the worker with no EXIF, no GPS IFD and no APP1/EXIF chunk.
const EXIF_HEADER = Buffer.from("Exif\0\0"); // JPEG APP1 payload marker
const WEBP_EXIF_CHUNK = Buffer.from("EXIF"); // RIFF chunk id used by WebP for EXIF

const gpsPhoto = () =>
  sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#3a7" } })
    .withExif({
      IFD0: { Make: "PhoneCo", Model: "Pocket 9", Software: "fw-1.2" },
      IFD3: {
        GPSVersionID: "2 3 0 0",
        GPSLatitudeRef: "N",
        GPSLatitude: "40/1 26/1 46/1",
        GPSLongitudeRef: "W",
        GPSLongitude: "79/1 58/1 56/1",
        GPSAltitudeRef: "0",
        GPSAltitude: "12/1",
      },
    })
    .jpeg()
    .toBuffer();

function setup() {
  const asset = { id: "a1", status: "PROCESSING", declaredMime: "image/jpeg", ingestKey: "in/a1" } as Record<string, unknown>;
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
  return { asset, store, deps: { db, store, buckets: { ingest: "ingest", private: "private" } } };
}

describe("worker output carries no EXIF or GPS (SEC-08c)", () => {
  it("MED-039 GPS-tagged JPEG -> READY variants with no EXIF segment, no WebP EXIF chunk, no GPS data", async () => {
    const { asset, store, deps } = setup();
    const original = await gpsPhoto();
    // Fixture sanity: the input really carries EXIF with GPS.
    expect(original.includes(EXIF_HEADER)).toBe(true);
    expect((await sharp(original).metadata()).exif).toBeDefined();
    store.objects.set("ingest/in/a1", original);

    expect(await processMedia(deps, "a1")).toBe("READY");
    expect(asset.status).toBe("READY");

    for (const key of ["private/variants/a1/thumb.webp", "private/variants/a1/medium.webp"]) {
      const out = store.objects.get(key)!;
      const meta = await sharp(out).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.iptc).toBeUndefined();
      expect(out.includes(EXIF_HEADER)).toBe(false);
      expect(out.includes(WEBP_EXIF_CHUNK)).toBe(false);
      expect(out.includes(Buffer.from("PhoneCo"))).toBe(false);
      expect(out.includes(Buffer.from("Pocket 9"))).toBe(false);
    }
  });
});
