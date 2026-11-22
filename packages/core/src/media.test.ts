import { describe, expect, it } from "vitest";
import { MEDIA_MAX_BYTES, sniffImageMime, uploadSlotInput } from "./media";

describe("media validation", () => {
  it("accepts jpeg/png/webp within 10MB and rejects other types or sizes", () => {
    expect(uploadSlotInput.parse({ mimeType: "image/webp", sizeBytes: MEDIA_MAX_BYTES }).sizeBytes).toBe(MEDIA_MAX_BYTES);
    for (const bad of [
      { mimeType: "image/gif", sizeBytes: 10 }, { mimeType: "image/svg+xml", sizeBytes: 10 }, { mimeType: "video/webm", sizeBytes: 10 }, { mimeType: "video/mp4", sizeBytes: 10, durationMs: 31_000 }, { mimeType: "video/mp4", sizeBytes: 52_428_801 },
      { mimeType: "image/png", sizeBytes: MEDIA_MAX_BYTES + 1 }, { mimeType: "image/png", sizeBytes: 0 }, { mimeType: "image/png", sizeBytes: 5, x: 1 },
    ]) expect(() => uploadSlotInput.parse(bad)).toThrow();
  });
  it("accepts MP4/MOV video up to 50 MiB and 30.5 s (M5)", () => {
    expect(uploadSlotInput.parse({ mimeType: "video/mp4", sizeBytes: 52_428_800, durationMs: 30_500 }).mimeType).toBe("video/mp4");
    expect(uploadSlotInput.parse({ mimeType: "video/quicktime", sizeBytes: 1000 }).mimeType).toBe("video/quicktime");
  });
  it("sniffs by magic bytes", () => {
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImageMime(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageMime(Buffer.from("GIF89a......"))).toBeNull();
  });
});
