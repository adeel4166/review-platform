import { describe, expect, it } from "vitest";
import { lshBuckets, minhash } from "@rp/core";
import { prismaNearDuplicateIndex } from "./jobs";

/** SEC-M7-03: the near-duplicate index survives a restart because it lives in review_lsh_buckets, not in process memory. */
describe("shared near-duplicate index", () => {
  it("a second 'process' (new adapter instance over the same tables) finds the first author's review", async () => {
    const buckets: { band: number; bucket: string; reviewId: string; authorId: string }[] = [];
    const reviews = [{ id: "r1", title: "Battery terrible", body: "The battery of this phone is terrible and the screen cracked after a week of normal use", status: "PUBLISHED" }];
    const db = {
      reviewLshBucket: {
        createMany: async ({ data }: { data: typeof buckets }) => { buckets.push(...data); },
        findMany: async ({ where }: { where: { OR: { band: number; bucket: string }[]; authorId: { not: string } } }) => buckets.filter((b) => where.OR.some((o) => o.band === b.band && o.bucket === b.bucket) && b.authorId !== where.authorId.not),
      },
      review: { findMany: async () => reviews },
    };
    const text = "Battery terrible The battery of this phone is terrible and the screen cracked after a week of normal use";
    await prismaNearDuplicateIndex(db).add({ reviewId: "r1", authorId: "a1", sig: minhash(text) });
    expect(buckets.length).toBe(lshBuckets(minhash(text)).length);
    const hits = await prismaNearDuplicateIndex(db).query({ reviewId: "r2", authorId: "a2", sig: minhash(text) }, 0.5);
    expect(hits.map((h) => h.reviewId)).toEqual(["r1"]);
    expect(await prismaNearDuplicateIndex(db).query({ reviewId: "r3", authorId: "a1", sig: minhash(text) })).toEqual([]); // same author is not a duplicate
  });
});
