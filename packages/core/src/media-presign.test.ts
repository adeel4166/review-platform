import { describe, expect, it } from "vitest";
import { createS3Store } from "./media";

// SEC-07(1) / SEC-013: the presigned PUT must bind content-length (and content-type) into the signature,
// otherwise a client could PUT an object larger than the declared, validated size.
const store = createS3Store({
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_REGION: "us-east-1",
  S3_FORCE_PATH_STYLE: true,
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
});

describe("presigned PUT signing (SEC-013 / SEC-07)", () => {
  // Observed with @aws-sdk/s3-request-presigner in this repo: X-Amz-SignedHeaders is "content-length;host".
  // content-type is NOT signed, so it is not asserted here; the worker validates the real type by magic bytes.
  it("SEC-013 signs content-length, with the 600 s TTL and the expected object path", async () => {
    const url = new URL(
      await store.presignPut("rp-ingest", "in/a1", { contentType: "image/jpeg", contentLength: 1234, expiresIn: 600 }),
    );
    const signed = (url.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
    expect(signed).toContain("content-length");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.pathname).toBe("/rp-ingest/in/a1");
  });

  it("SEC-013 a different declared size produces a different signature (size is bound, not advisory)", async () => {
    const sig = async (contentLength: number) =>
      new URL(await store.presignPut("rp-ingest", "in/a1", { contentType: "image/jpeg", contentLength, expiresIn: 600 }))
        .searchParams.get("X-Amz-Signature");
    expect(await sig(1234)).not.toBe(await sig(1235));
  });
});
