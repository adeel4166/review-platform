import type { ImageUrlResolver } from "@rp/core";
import type { Db } from "./db";
import { loadProductImages } from "./product-images";
import { HttpError } from "./http";
import type { z } from "zod";
import type { productListQuery } from "./validation";

const productSelect = {
  id: true, slug: true, name: true, brandName: true, description: true, specs: true,
  ratingAverage: true, ratingCount: true, reviewCount: true, ratingHistogram: true, verifiedRatingAverage: true, verifiedRatingCount: true, createdAt: true,
  category: { select: { id: true, slug: true, name: true } },
} as const;

/** Only ACTIVE products are public. */
export async function listProducts(db: Db, q: z.infer<typeof productListQuery>, images: ImageUrlResolver = {}) {
  const where = {
    status: "ACTIVE" as const,
    ...(q.category ? { category: { slug: q.category } } : {}),
    ...(q.q ? { name: { contains: q.q } } : {}),
  };
  const [items, total] = await Promise.all([
    db.product.findMany({
      where, select: productSelect, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize, take: q.pageSize,
    }),
    db.product.count({ where }),
  ]);
  // One batched lookup for every card: `primaryImage` is null until an image is approved and published (the UI shows its placeholder).
  const imgs = await loadProductImages(db, items.map((i) => i.id), images);
  return { items: items.map((i) => ({ ...i, primaryImage: imgs.get(i.id)?.primaryImage ?? null, gallery: imgs.get(i.id)?.gallery ?? [] })), page: q.page, pageSize: q.pageSize, total };
}

/** Accepts either the product id or its slug. */
export async function getProduct(db: Db, idOrSlug: string, images: ImageUrlResolver = {}) {
  const p = await db.product.findFirst({
    where: { status: "ACTIVE", OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: productSelect,
  });
  if (!p) throw new HttpError(404, "not_found", "Product not found");
  const imgs = (await loadProductImages(db, [p.id], images)).get(p.id);
  return { ...p, primaryImage: imgs?.primaryImage ?? null, gallery: imgs?.gallery ?? [] };
}
