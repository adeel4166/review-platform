import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { listProducts } from "@/server/products";
import { productListQuery } from "@/server/validation";

export async function GET(req: Request) {
  return handle(async () => {
    const q = productListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
    return json(await listProducts(db, q));
  });
}
