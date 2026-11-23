import { db } from "@/server/db";
import { getImageResolver } from "@/server/storage";
import { handle, json } from "@/server/http";
import { listProducts } from "@/server/products";
import { limitPublicRead } from "@/server/ratelimit";
import { productListQuery } from "@/server/validation";

export async function GET(req: Request) {
  return handle(async () => {
    await limitPublicRead(req); // SEC-V3-01: public typeahead (Cmd+K) is unauthenticated; per-IP cap
    const q = productListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
    return json(await listProducts(db, q, getImageResolver()));
  });
}
