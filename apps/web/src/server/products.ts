import type { Db } from "./db";
import { HttpError } from "./http";
import type { z } from "zod";
import type { productListQuery } from "./validation";

const productSelect = {
  id: true, slug: true, name: true, brandName: true, description: true, specs: true,
  ratingAverage: true, ratingCount: true, reviewCount: true, ratingHistogram: true, createdAt: true,
  category: { select: { id: true, slug: true, name: true } },
} as const;

/** Only ACTIVE products are public. */
export async function listProducts(db: Db, q: z.infer<typeof productListQuery>) {
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
  return { items, page: q.page, pageSize: q.pageSize, total };
}

/** Accepts either the product id or its slug. */
export async function getProduct(db: Db, idOrSlug: string) {
  const p = await db.product.findFirst({
    where: { status: "ACTIVE", OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: productSelect,
  });
  if (!p) throw new HttpError(404, "not_found", "Product not found");
  return p;
}
