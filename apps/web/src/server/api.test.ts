import { describe, expect, it, vi, beforeEach } from "vitest";
import { ZodError } from "zod";
import { HttpError, handle } from "./http";
import { registerInput, reviewInput, reviewUpdateInput, reviewListQuery, productListQuery } from "./validation";
import { createReview, deleteOwnReview, listPublishedReviews, updateOwnReview } from "./reviews";
import { getProduct, listProducts } from "./products";
import type { Db } from "./db";

function fakeDb() {
  const tx = {
    review: { create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    reviewRevision: { updateMany: vi.fn(), create: vi.fn() },
    outboxEvent: { create: vi.fn() },
  };
  const db = {
    product: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    review: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { db: db as unknown as Db, m: db, tx };
}
const valid = { rating: 5, title: "Great", body: "Really solid product overall." };

describe("validation", () => {
  it("accepts a valid review and rejects bad ratings/titles/extra keys", () => {
    expect(reviewInput.parse(valid)).toEqual(valid);
    for (const bad of [{ ...valid, rating: 0 }, { ...valid, rating: 6 }, { ...valid, rating: 4.5 },
      { ...valid, title: "  " }, { ...valid, body: "short" }, { ...valid, status: "PUBLISHED" }]) {
      expect(() => reviewInput.parse(bad)).toThrow(ZodError);
    }
  });
  it("requires at least one field on update", () => {
    expect(() => reviewUpdateInput.parse({})).toThrow(ZodError);
    expect(reviewUpdateInput.parse({ rating: 2 })).toEqual({ rating: 2 });
  });
  it("bounds pagination", () => {
    expect(reviewListQuery.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(() => reviewListQuery.parse({ pageSize: "500" })).toThrow();
    expect(() => productListQuery.parse({ page: "0" })).toThrow();
  });
  it("normalises registration and enforces password length", () => {
    const r = registerInput.parse({ email: " A@B.com ", password: "x".repeat(10), handle: "abc", displayName: "A" });
    expect(r.email).toBe("a@b.com");
    expect(() => registerInput.parse({ email: "a@b.com", password: "short", handle: "abc", displayName: "A" })).toThrow();
    expect(() => registerInput.parse({ email: "a@b.com", password: "x".repeat(10), handle: "Bad Handle", displayName: "A" })).toThrow();
  });
});

describe("handle()", () => {
  it("maps errors to status codes without leaking internals", async () => {
    expect((await handle(async () => { throw new HttpError(401, "unauthenticated"); })).status).toBe(401);
    const v = await handle(async () => { reviewInput.parse({}); return new Response(); });
    expect(v.status).toBe(400);
    expect((await v.json()).error.code).toBe("validation_error");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await handle(async () => { throw new Error("secret db detail"); });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret");
  });
});

describe("products", () => {
  it("lists only ACTIVE products with pagination", async () => {
    const { db, m } = fakeDb();
    m.product.findMany.mockResolvedValue([{ id: "p1" }]);
    m.product.count.mockResolvedValue(41);
    const res = await listProducts(db, { page: 3, pageSize: 20, category: "books" });
    expect(res.total).toBe(41);
    const arg = m.product.findMany.mock.calls[0]![0];
    expect(arg.where).toMatchObject({ status: "ACTIVE", category: { slug: "books" } });
    expect(arg).toMatchObject({ skip: 40, take: 20 });
  });
  it("404s on unknown product", async () => {
    const { db, m } = fakeDb();
    m.product.findFirst.mockResolvedValue(null);
    await expect(getProduct(db, "nope")).rejects.toMatchObject({ status: 404 });
  });
});

describe("reviews", () => {
  let f: ReturnType<typeof fakeDb>;
  beforeEach(() => { f = fakeDb(); });

  it("lists published only and never selects author email", async () => {
    f.m.product.findFirst.mockResolvedValue({ id: "p" });
    f.m.review.findMany.mockResolvedValue([]);
    f.m.review.count.mockResolvedValue(0);
    await listPublishedReviews(f.db, "p", 2, 10);
    const arg = f.m.review.findMany.mock.calls[0]![0];
    expect(arg.where).toEqual({ productId: "p", status: "PUBLISHED" });
    expect(arg).toMatchObject({ skip: 10, take: 10 });
    expect(JSON.stringify(arg.select)).not.toContain("email");
  });
  it("404s listing reviews of a missing product", async () => {
    f.m.product.findFirst.mockResolvedValue(null);
    await expect(listPublishedReviews(f.db, "x", 1, 10)).rejects.toMatchObject({ status: 404 });
  });

  it("creates reviews as PENDING with revision + outbox event", async () => {
    f.m.product.findFirst.mockResolvedValue({ id: "p" });
    f.tx.review.create.mockResolvedValue({ id: "r1" });
    await createReview(f.db, "u1", "p", valid);
    const data = f.tx.review.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ status: "PENDING", authorId: "u1", productId: "p" });
    expect(data.revisions.create).toMatchObject({ version: 1, status: "PENDING" });
    expect(f.tx.outboxEvent.create).toHaveBeenCalledOnce();
  });
  it("returns 409 on duplicate review and 404 on unknown product", async () => {
    f.m.product.findFirst.mockResolvedValue({ id: "p" });
    f.tx.review.create.mockRejectedValue({ code: "P2002" });
    await expect(createReview(f.db, "u1", "p", valid)).rejects.toMatchObject({ status: 409 });
    f.m.product.findFirst.mockResolvedValue(null);
    await expect(createReview(f.db, "u1", "p", valid)).rejects.toMatchObject({ status: 404 });
  });

  // Edits, revisions and deletes of PENDING/PUBLISHED reviews are covered in m4.test.ts (REV-001..006).
  it("hides other users' reviews (404); the legacy no-expectedVersion shape refuses PUBLISHED reviews (409)", async () => {
    f.m.review.findFirst.mockResolvedValue(null);
    await expect(updateOwnReview(f.db, "u2", "r", { rating: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(deleteOwnReview(f.db, "u2", "r")).rejects.toMatchObject({ status: 404 });
    f.m.review.findFirst.mockResolvedValue({ id: "r", status: "PUBLISHED", currentVersion: 1 });
    await expect(updateOwnReview(f.db, "u1", "r", { rating: 1 })).rejects.toMatchObject({ status: 409 });
  });

});
