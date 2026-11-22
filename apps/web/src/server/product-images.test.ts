import { beforeEach, describe, expect, it } from "vitest";
import { FakeObjectStore } from "@rp/core";
import { createProductImageSlot, decideProductImage, listProductImagesForManager, loadProductImages, removeProductImage, reorderProductImages, updateProductImage } from "./product-images";
import { productImageOrderInput, productImagePatchInput, productImageSlotInput } from "./validation";
import type { Storage } from "./media";
import type { Actor } from "./session";
import type { HttpError } from "./http";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const tf = { enrolled: true, verified: true };
const actor = (id: string, role: Actor["role"] = "user"): Actor => ({ id, role, twoFactor: tf });
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: HttpError) => `${e.status}:${e.code}`);

function makeDb(sellerStatus = "VERIFIED") {
  const t = { images: [] as Row[], assets: [] as Row[], outbox: [] as Row[], audit: [] as Row[], cases: [] as Row[] };
  let n = 0;
  const members: Row = { "S1:owner": "OWNER", "S1:manager": "MANAGER", "S1:responder": "RESPONDER", "S2:other": "OWNER" };
  const db: Row = {
    product: { findUnique: async ({ where }: Row) => (where.id === "P1" ? { id: "P1", name: "Kettle", sellerId: "S1", status: "ACTIVE" } : where.id === "P0" ? { id: "P0", name: "Orphan", sellerId: null, status: "ACTIVE" } : null) },
    user: { findUnique: async () => ({ status: "ACTIVE" }) },
    sellerMember: { findUnique: async ({ where }: Row) => { const r = members[`${where.sellerId_userId.sellerId}:${where.sellerId_userId.userId}`]; return r ? { role: r } : null; } },
    enforcementAction: { findFirst: async () => null },
    seller: { findUnique: async () => ({ status: sellerStatus }) },
    mediaAsset: {
      count: async () => 0,
      create: async ({ data }: Row) => { const r = { id: `A${++n}`, ...data }; t.assets.push(r); return r; },
      update: async ({ where, data }: Row) => Object.assign(t.assets.find((a) => a.id === where.id)!, data),
    },
    productImage: {
      count: async ({ where }: Row) => t.images.filter((i) => i.productId === where.productId).length,
      create: async ({ data }: Row) => { const r = { id: `I${++n}`, createdAt: new Date(n), publishedAt: null, ...data }; t.images.push(r); return r; },
      findFirst: async ({ where }: Row) => t.images.find((i) => i.id === where.id && i.productId === where.productId) ?? null,
      findUnique: async ({ where }: Row) => { const i = t.images.find((x) => x.id === where.id); return i ? { ...i, mediaAsset: t.assets.find((a) => a.id === i.mediaAssetId) } : null; },
      findMany: async ({ where }: Row) => t.images.filter((i) => i.productId === where.productId || where.productId?.in?.includes(i.productId)).filter((i) => where.publishedAt === undefined || i.publishedAt).sort((a, b) => a.position - b.position).map((i) => ({ ...i, mediaAsset: t.assets.find((a) => a.id === i.mediaAssetId) ?? { status: "READY", failureReason: null } })),
      update: async ({ where, data }: Row) => Object.assign(t.images.find((i) => i.id === where.id)!, data),
      updateMany: async ({ where, data }: Row) => { const rows = t.images.filter((i) => i.productId === where.productId && i.isPrimary === where.isPrimary && i.id !== where.id.not); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; },
      delete: async ({ where }: Row) => { t.images = t.images.filter((i) => i.id !== where.id); },
    },
    moderationCase: { create: async ({ data }: Row) => { const r = { id: `C${++n}`, ...data }; t.cases.push(r); return r; } },
    outboxEvent: { create: async ({ data }: Row) => { t.outbox.push(data); } },
    auditLog: { create: async ({ data }: Row) => { t.audit.push(data); } },
    $queryRaw: async () => [],
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db: db as never, t };
}
const st: Storage = { store: new FakeObjectStore(), buckets: { ingest: "ingest", private: "private" }, publicBaseUrl: "https://cdn.example" };
const input = { mimeType: "image/png" as const, sizeBytes: 1000, alt: "Kettle, front view" };

describe("authorization (task #103)", () => {
  let h: ReturnType<typeof makeDb>;
  beforeEach(() => { h = makeDb(); });
  it("a member of ANOTHER seller gets 403 on every write", async () => {
    const o = actor("other");
    expect(await code(createProductImageSlot(h.db, st, o, "P1", input))).toBe("403:forbidden");
    expect(await code(updateProductImage(h.db, o, "P1", "I1", { alt: "x" }))).toBe("403:forbidden");
    expect(await code(reorderProductImages(h.db, o, "P1", ["I1"]))).toBe("403:forbidden");
    expect(await code(removeProductImage(h.db, o, "P1", "I1"))).toBe("403:forbidden");
    expect(await code(listProductImagesForManager(h.db, o, "P1", {}))).toBe("403:forbidden");
    expect(h.t.assets).toHaveLength(0);
  });
  it("a plain user and an unclaimed product are 403; an unknown product is 404", async () => {
    expect(await code(createProductImageSlot(h.db, st, actor("nobody"), "P1", input))).toBe("403:forbidden");
    expect(await code(createProductImageSlot(h.db, st, actor("owner"), "P0", input))).toBe("403:forbidden");
    expect(await code(createProductImageSlot(h.db, st, actor("owner"), "NOPE", input))).toBe("404:not_found");
  });
  it("a RESPONDER of the owning seller is denied", async () => expect(await code(createProductImageSlot(h.db, st, actor("responder"), "P1", input))).toBe("403:FORBIDDEN_ROLE"));
  it("an unverified owning seller is denied", async () => {
    const u = makeDb("UNVERIFIED");
    expect(await code(createProductImageSlot(u.db, st, actor("owner"), "P1", input))).toBe("403:SELLER_NOT_VERIFIED");
  });
  it("OWNER and MANAGER of the verified owning seller are allowed; staff admin is allowed; moderator is not", async () => {
    expect(await code(createProductImageSlot(h.db, st, actor("owner"), "P1", input))).toBe("ok");
    expect(await code(createProductImageSlot(h.db, st, actor("manager"), "P1", input))).toBe("ok");
    expect(await code(createProductImageSlot(h.db, st, actor("boss", "admin"), "P1", input))).toBe("ok");
    expect(await code(createProductImageSlot(h.db, st, actor("mod", "moderator"), "P1", input))).toBe("403:forbidden");
  });
  it("staff without a verified second factor are denied", async () => {
    expect(await code(createProductImageSlot(h.db, st, { id: "boss", role: "admin", twoFactor: { enrolled: true, verified: false } }, "P1", input))).toBe("403:TWO_FACTOR_REQUIRED");
  });
});

describe("upload slot", () => {
  it("creates a PRODUCT_IMAGE asset without a review, a gallery row with alt, primary for the first image, and a presigned PUT", async () => {
    const h = makeDb();
    const r = await createProductImageSlot(h.db, st, actor("owner"), "P1", input);
    expect(h.t.assets[0]).toMatchObject({ purpose: "PRODUCT_IMAGE", reviewId: null, kind: "IMAGE", ingestKey: `in/${r.assetId}` });
    expect(h.t.images[0]).toMatchObject({ alt: "Kettle, front view", position: 0, isPrimary: true, productId: "P1" });
    expect(r.uploadUrl).toContain(`ingest/in/${r.assetId}`);
    await createProductImageSlot(h.db, st, actor("owner"), "P1", input);
    expect(h.t.images[1]).toMatchObject({ position: 1, isPrimary: false });
    expect(h.t.audit.map((a) => a.action)).toEqual(["product_image.created", "product_image.created"]);
  });
  it("409 at 12 images and 413 over 10 MB; nothing is created", async () => {
    const h = makeDb();
    for (let i = 0; i < 12; i++) await createProductImageSlot(h.db, st, actor("owner"), "P1", input);
    expect(await code(createProductImageSlot(h.db, st, actor("owner"), "P1", input))).toBe("409:image_limit");
    expect(await code(createProductImageSlot(h.db, st, actor("owner"), "P1", { ...input, sizeBytes: 11 * 1024 * 1024 }))).toBe("413:too_large");
    expect(h.t.images).toHaveLength(12);
  });
  it("alt text is required and validated at the API boundary", () => {
    expect(productImageSlotInput.safeParse({ mimeType: "image/png", sizeBytes: 5 }).success).toBe(false);
    expect(productImageSlotInput.safeParse({ ...input, alt: "   " }).success).toBe(false);
    expect(productImageSlotInput.safeParse({ ...input, alt: "see http://x.example" }).success).toBe(false);
    expect(productImageSlotInput.safeParse({ ...input, mimeType: "video/mp4" }).success).toBe(false);
    expect(productImageSlotInput.parse({ ...input, alt: "  Kettle   front " }).alt).toBe("Kettle front");
    expect(productImagePatchInput.safeParse({}).success).toBe(false);
    expect(productImagePatchInput.safeParse({ alt: "" }).success).toBe(false);
    expect(productImagePatchInput.safeParse({ isPrimary: false }).success).toBe(false);
    expect(productImageOrderInput.safeParse({ imageIds: [] }).success).toBe(false);
  });
});

describe("primary, reorder, remove, moderation", () => {
  it("set primary moves the single primary; reorder renumbers; bad order is 422", async () => {
    const h = makeDb();
    for (let i = 0; i < 3; i++) await createProductImageSlot(h.db, st, actor("owner"), "P1", input);
    const ids = h.t.images.map((i) => i.id);
    await updateProductImage(h.db, actor("owner"), "P1", ids[2]!, { isPrimary: true, alt: "New alt" });
    expect(h.t.images.filter((i) => i.isPrimary).map((i) => i.id)).toEqual([ids[2]]);
    expect(h.t.images[2]!.alt).toBe("New alt");
    await reorderProductImages(h.db, actor("owner"), "P1", [ids[2]!, ids[0]!, ids[1]!]);
    expect(h.t.images.map((i) => [i.id, i.position])).toEqual([[ids[0], 1], [ids[1], 2], [ids[2], 0]]);
    expect(await code(reorderProductImages(h.db, actor("owner"), "P1", [ids[0]!]))).toBe("422:invalid_order");
    expect(await code(updateProductImage(h.db, actor("owner"), "P1", "missing", { alt: "x" }))).toBe("404:not_found");
  });
  it("remove deletes the row, closes the position gap and queues a demote", async () => {
    const h = makeDb();
    for (let i = 0; i < 3; i++) await createProductImageSlot(h.db, st, actor("owner"), "P1", input);
    const [a, b, c] = h.t.images.map((i) => i.id);
    await removeProductImage(h.db, actor("owner"), "P1", b!);
    expect(h.t.images.map((i) => [i.id, i.position])).toEqual([[a, 0], [c, 1]]);
    expect(h.t.outbox[0]).toMatchObject({ type: "media.demote_requested", payload: { reason: "PRODUCT_IMAGE_REMOVED" } });
  });
  it("approve records an APPROVED MEDIA case and requests promotion; own uploads cannot be approved; not-ready is 409", async () => {
    const h = makeDb();
    await createProductImageSlot(h.db, st, actor("owner"), "P1", input);
    const imageId = h.t.images[0]!.id;
    expect(await code(decideProductImage(h.db, actor("mod", "moderator"), imageId, "approve"))).toBe("409:not_ready");
    Object.assign(h.t.assets[0]!, { status: "READY", bucket: "PRIVATE" });
    expect(await code(decideProductImage(h.db, actor("owner"), imageId, "approve"))).toBe("403:self_approval");
    expect(await code(decideProductImage(h.db, actor("mod", "moderator"), imageId, "approve"))).toBe("ok");
    expect(h.t.cases[0]).toMatchObject({ subjectType: "MEDIA", state: "APPROVED", mediaAssetId: h.t.assets[0]!.id });
    expect(h.t.outbox.at(-1)).toMatchObject({ type: "media.promote_requested", payload: { caseId: h.t.cases[0]!.id } });
  });
});

describe("public read model", () => {
  it("returns primaryImage + gallery (url,width,height,alt) from published rows only; products without images get null/[]", async () => {
    const h = makeDb();
    h.t.images.push(
      { id: "i1", productId: "P1", publicId: "m/a/medium", format: "webp", width: 800, height: 600, alt: "Front", position: 1, isPrimary: false, publishedAt: new Date(1), createdAt: new Date(1) },
      { id: "i2", productId: "P1", publicId: "m/b/medium", format: "webp", width: 800, height: 600, alt: "Side", position: 0, isPrimary: false, publishedAt: new Date(1), createdAt: new Date(2) },
      { id: "i3", productId: "P1", publicId: null, format: "webp", width: null, height: null, alt: "Pending", position: 2, isPrimary: false, publishedAt: null, createdAt: new Date(3) },
    );
    const m = await loadProductImages(h.db, ["P1", "P2"], { publicBaseUrl: "https://cdn.example" });
    expect(m.get("P1")!.primaryImage).toEqual({ url: "https://cdn.example/m/b/medium.webp", width: 800, height: 600, alt: "Side" });
    expect(m.get("P1")!.gallery.map((g) => g.alt)).toEqual(["Side", "Front"]);
    expect(m.get("P2")).toEqual({ primaryImage: null, gallery: [] });
  });
});

import { listProducts, getProduct } from "./products";
import { compare, clearCompareCache } from "./compare";

describe("product list / detail / compare return primaryImage and gallery", () => {
  const img = { productId: "P1", publicId: "m/a/medium", format: "webp", width: 800, height: 600, alt: "Front", position: 0, isPrimary: true, publishedAt: new Date(1), createdAt: new Date(1), id: "i1" };
  const base = (id: string) => ({ id, slug: id, name: id, status: "ACTIVE", mergedIntoId: null, categoryId: "c", ratingAverage: null, ratingCount: 0, verifiedRatingAverage: null, verifiedRatingCount: 0, ratingHistogram: null, specs: null, sellerId: null });
  const db = {
    product: { findMany: async ({ where }: Row) => (where.id?.in ?? ["P1", "P2"]).map(base), count: async () => 2, findFirst: async () => base("P1") },
    productImage: { findMany: async () => [img] },
    seller: { findMany: async () => [] },
  } as never;
  const r = { publicBaseUrl: "https://cdn.example" };
  const want = { url: "https://cdn.example/m/a/medium.webp", width: 800, height: 600, alt: "Front" };
  it("list", async () => {
    const out = await listProducts(db, { page: 1, pageSize: 20 }, r);
    expect(out.items[0]).toMatchObject({ id: "P1", primaryImage: want, gallery: [want] });
    expect(out.items[1]).toMatchObject({ id: "P2", primaryImage: null, gallery: [] });
  });
  it("detail", async () => expect(await getProduct(db, "P1", r)).toMatchObject({ primaryImage: want, gallery: [want] }));
  it("compare (image keeps the primary url for existing clients)", async () => {
    clearCompareCache();
    const out = (await compare(db, "P1,P2", Date.now(), r)) as { items: Row[] };
    expect(out.items[0]).toMatchObject({ id: "P1", image: want.url, primaryImage: want, gallery: [want] });
    expect(out.items[1]).toMatchObject({ id: "P2", image: null, primaryImage: null, gallery: [] });
  });
});
