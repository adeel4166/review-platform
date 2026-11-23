import { describe, expect, it } from "vitest";
import { cloudinaryConfigFromEnv, cloudinaryTimestamp, cloudinaryDeliveryUrl, cloudinarySignature, createCloudinaryStore, routePublicBucket, splitCloudinaryKey } from "./cloudinary";
import type { Clock } from "./clock";
import type { ObjectStore } from "./media";

const T0 = new Date("2026-01-01T00:00:00.000Z"); // 1767225600 s
const KNOWN_DELETE_SIG = "e1cb01fd35f88f0cffc6861003a73df20077f816";
const fixedClock: Clock = { now: () => T0 };

describe("cloudinary public tier", () => {
  it("maps keys to public_id + resource type", () => {
    expect(splitCloudinaryKey("m/a1/medium.webp")).toEqual({ publicId: "m/a1/medium", ext: "webp", resourceType: "image" });
    expect(splitCloudinaryKey("m/a1/video.mp4")).toEqual({ publicId: "m/a1/video", ext: "mp4", resourceType: "video" });
  });
  it("builds optimised delivery URLs", () => {
    expect(cloudinaryDeliveryUrl("demo", "m/a1/thumb.webp")).toBe("https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/m/a1/thumb.webp");
    expect(cloudinaryDeliveryUrl("demo", "m/a1/video.mp4")).toBe("https://res.cloudinary.com/demo/video/upload/q_auto,vc_auto/m/a1/video.mp4");
  });
  it("signs like Cloudinary's documented example", () => {
    // https://cloudinary.com/documentation/authentication_signatures example
    expect(cloudinarySignature({ eager: "w_400,h_300,c_pad|w_260,h_200,c_crop", public_id: "sample_image", timestamp: "1315060510" }, "abcd")).toBe("bfd09f95f331f558cbd1320e67aa8d488770583e");
  });
  it("is off unless MEDIA_PUBLIC_STORE=cloudinary, and then requires all three vars", () => {
    expect(cloudinaryConfigFromEnv({})).toBeNull();
    expect(() => cloudinaryConfigFromEnv({ MEDIA_PUBLIC_STORE: "cloudinary", CLOUDINARY_CLOUD_NAME: "x" })).toThrow();
  });
  it("uploads with a signature and never sends the secret", async () => {
    const calls: { url: string; body?: FormData }[] = [];
    const fake = (async (url: string, init?: RequestInit) => { calls.push({ url, body: init?.body as FormData }); return new Response("{}", { status: 200 }); }) as typeof fetch;
    const s = createCloudinaryStore({ cloudName: "c", apiKey: "k", apiSecret: "SECRET", fetch: fake }, fixedClock);
    await s.put("rp-public", "m/a1/medium.webp", Buffer.from("x"), "image/webp");
    expect(calls[0]!.url).toBe("https://api.cloudinary.com/v1_1/c/image/upload");
    const f = calls[0]!.body!;
    expect(f.get("public_id")).toBe("m/a1/medium");
    expect(f.get("overwrite")).toBe("false");
    expect(typeof f.get("signature")).toBe("string");
    for (const [, v] of f.entries()) expect(String(v)).not.toContain("SECRET");
  });
  it("takes the signing timestamp from the injected clock (ADR-0024)", () => {
    expect(cloudinaryTimestamp(fixedClock)).toBe("1767225600");
    let t = T0.getTime();
    const moving: Clock = { now: () => new Date(t) };
    t += 1999; // sub-second remainder is floored
    expect(cloudinaryTimestamp(moving)).toBe("1767225601");
    t += 3_600_000; // window moves exactly with the clock
    expect(cloudinaryTimestamp(moving)).toBe("1767229201");
  });
  it("produces a known deterministic signature for a fixed clock", async () => {
    const calls: FormData[] = [];
    const fake = (async (_u: string, init?: RequestInit) => { calls.push(init?.body as FormData); return new Response("{}", { status: 200 }); }) as typeof fetch;
    const s = createCloudinaryStore({ cloudName: "c", apiKey: "k", apiSecret: "abcd", fetch: fake }, fixedClock);
    await s.delete("rp-public", "m/a1/medium.webp");
    const f = calls[0]!;
    expect(f.get("timestamp")).toBe("1767225600");
    expect(f.get("api_key")).toBe("k");
    expect(f.get("signature")).toBe(cloudinarySignature({ public_id: "m/a1/medium", invalidate: "true", timestamp: "1767225600" }, "abcd"));
    expect(f.get("signature")).toBe(KNOWN_DELETE_SIG);
  });
  it("routes only the public bucket", async () => {
    const hits: string[] = [];
    const mk = (n: string) => ({ head: async () => { hits.push(n); return null; } }) as unknown as ObjectStore;
    const r = routePublicBucket(mk("s3"), "rp-public", mk("cld"));
    await r.head("rp-public", "k"); await r.head("rp-private", "k");
    expect(hits).toEqual(["cld", "s3"]);
  });
});
