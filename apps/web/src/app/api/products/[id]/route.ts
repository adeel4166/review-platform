import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { getProduct } from "@/server/products";
import { idParam } from "@/server/validation";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => json(await getProduct(db, idParam.parse((await ctx.params).id))));
}
