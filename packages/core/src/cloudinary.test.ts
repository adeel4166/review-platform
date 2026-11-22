import { describe, expect, it } from "vitest";
import { cloudinaryConfigFromEnv, cloudinaryDeliveryUrl, cloudinarySignature, createCloudinaryStore, routePublicBucket, splitCloudinaryKey } from "./cloudinary";
import type { ObjectStore } from "./media";

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
    const s = createCloudinaryStore({ cloudName: "c", apiKey: "k", apiSecret: "SECRET", fetch: fake });
    await s.put("rp-public", "m/a1/medium.webp", Buffer.from("x"), "image/webp");
    expect(calls[0]!.url).toBe("https://api.cloudinary.com/v1_1/c/image/upload");
    const f = calls[0]!.body!;
    expect(f.get("public_id")).toBe("m/a1/medium");
    expect(f.get("overwrite")).toBe("false");
    expect(typeof f.get("signature")).toBe("string");
    for (const [, v] of f.entries()) expect(String(v)).not.toContain("SECRET");
  });
  it("routes only the public bucket", async () => {
    const hits: string[] = [];
    const mk = (n: string) => ({ head: async () => { hits.push(n); return null; } }) as unknown as ObjectStore;
    const r = routePublicBucket(mk("s3"), "rp-public", mk("cld"));
    await r.head("rp-public", "k"); await r.head("rp-private", "k");
    expect(hits).toEqual(["cld", "s3"]);
  });
});
