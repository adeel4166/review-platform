import { describe, expect, it } from "vitest";
import { FakeObjectStore } from "@rp/core";
import { demoteMedia, promoteMedia, promotable, reconcilePublication, type PublishDb } from "./media/publish";

const buckets = { private: "private", public: "public" };

function setup(over: { asset?: Record<string, unknown>; caseRow?: Record<string, unknown> | null; hasRow?: boolean } = {}) {
  const asset: Record<string, unknown> = {
    id: "a1", status: "READY", bucket: "PRIVATE", kind: "IMAGE", purpose: "PRODUCT_IMAGE", virusScannedAt: new Date(), metadataStripped: true, reviewId: null, width: 1024, height: 768,
    attachedInVersion: null, detachedInVersion: null, thumbKey: "variants/a1/thumb.webp", mediumKey: "variants/a1/medium.webp", videoKey: null, ...over.asset,
  };
  const gallery: Record<string, unknown> = { publicId: null, publishedAt: null };
  const hasRow = over.hasRow ?? true;
  const caseRow = over.caseRow === undefined ? { id: "c1", state: "APPROVED", reviewId: null, version: 1, subjectType: "MEDIA", mediaAssetId: "a1" } : over.caseRow;
  const db: PublishDb = {
    mediaAsset: {
      findUnique: async () => ({ ...asset, review: null, productImage: hasRow ? { id: "i1" } : null }) as never,
      findMany: async (a) => ((a as { where: { bucket: string } }).where.bucket === asset.bucket ? [{ ...asset, review: null, productImage: hasRow ? { id: "i1" } : null } as never] : []),
      updateMany: async (a) => {
        const { data } = a as { data: Record<string, unknown> };
        const next = { ...asset, ...data };
        if (next.bucket === "PUBLIC" && !(next.status === "READY" && next.virusScannedAt && next.metadataStripped === true && next.moderationClearedAt && next.promotedAt)) throw new Error("CHECK chk_media_public_bucket");
        Object.assign(asset, data);
        return { count: 1 };
      },
    },
    productImage: { updateMany: async (a) => { Object.assign(gallery, (a as { data: Record<string, unknown> }).data); return { count: 1 }; } },
    moderationCase: { findUnique: async () => caseRow as never, findFirst: async () => null },
  };
  const store = new FakeObjectStore();
  store.objects.set("private/variants/a1/thumb.webp", Buffer.from("T"));
  store.objects.set("private/variants/a1/medium.webp", Buffer.from("M"));
  return { asset, gallery, store, deps: { db, store, buckets, cdn: { purgeUrls: async () => undefined }, publicBaseUrl: "https://media.example/" } };
}

describe("product image publication (ADR-0034 D11)", () => {
  it("an approved MEDIA case promotes the asset and publishes the gallery row with the store-neutral public id", async () => {
    const t = setup();
    expect(await promoteMedia(t.deps, "a1", "c1")).toBe("PROMOTED");
    expect(t.asset).toMatchObject({ bucket: "PUBLIC", mediumKey: "m/a1/medium.webp" });
    expect(t.gallery).toMatchObject({ publicId: "m/a1/medium", format: "webp", width: 1024, height: 768 });
    expect(t.gallery.publishedAt).toBeInstanceOf(Date);
    expect([...t.store.objects.keys()].filter((k) => k.startsWith("public/")).sort()).toEqual(["public/m/a1/medium.webp", "public/m/a1/thumb.webp"]);
  });
  it.each([
    ["no approved case", { caseRow: null }],
    ["case still pending", { caseRow: { id: "c1", state: "NEEDS_HUMAN", reviewId: null, version: 1, subjectType: "MEDIA", mediaAssetId: "a1" } }],
    ["case belongs to another asset", { caseRow: { id: "c1", state: "APPROVED", reviewId: null, version: 1, subjectType: "MEDIA", mediaAssetId: "other" } }],
    ["a REVIEW case cannot clear a product image", { caseRow: { id: "c1", state: "APPROVED", reviewId: "r1", version: 1, subjectType: "REVIEW", mediaAssetId: null } }],
    ["not scanned", { asset: { virusScannedAt: null } }],
    ["gallery row was removed", { hasRow: false }],
    ["still processing", { asset: { status: "PROCESSING" } }],
  ])("stays private: %s", async (_n, over) => {
    const t = setup(over as never);
    expect(await promoteMedia(t.deps, "a1", "c1")).toBe("SKIPPED");
    expect(t.asset.bucket).toBe("PRIVATE");
    expect(t.gallery.publishedAt).toBeNull();
    expect([...t.store.objects.keys()].some((k) => k.startsWith("public/"))).toBe(false);
  });
  it("a video can never be a product image", () => {
    expect(promotable({ ...setup().asset, kind: "VIDEO", productImage: { id: "i" }, review: null } as never, { state: "APPROVED", reviewId: null, version: 1, subjectType: "MEDIA", mediaAssetId: "a1" })).toBe("no_gallery_row");
  });
  it("demote unpublishes the gallery row before the bytes go private", async () => {
    const t = setup();
    await promoteMedia(t.deps, "a1", "c1");
    expect(await demoteMedia(t.deps, "a1", "PRODUCT_IMAGE_REMOVED")).toBe("DEMOTED");
    expect(t.gallery.publishedAt).toBeNull();
    expect(t.asset).toMatchObject({ bucket: "PRIVATE", promotedAt: null });
    expect([...t.store.objects.keys()].some((k) => k.startsWith("public/"))).toBe(false);
  });
  it("reconcile demotes a public product image whose gallery row is gone and leaves live ones alone", async () => {
    const live = setup();
    await promoteMedia(live.deps, "a1", "c1");
    expect(await reconcilePublication(live.deps)).toEqual({ demoted: 0, promoted: 0 });
    const gone = setup({ asset: { bucket: "PUBLIC", moderationClearedAt: new Date(), promotedAt: new Date() }, hasRow: false });
    gone.store.objects.set("public/m/a1/medium.webp", Buffer.from("M"));
    expect(await reconcilePublication(gone.deps)).toEqual({ demoted: 1, promoted: 0 });
  });
});
