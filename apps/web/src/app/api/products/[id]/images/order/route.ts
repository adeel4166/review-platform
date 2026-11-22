import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { reorderProductImages } from "@/server/product-images";
import { requireUser } from "@/server/session";
import { idParam, productImageOrderInput } from "@/server/validation";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    const input = productImageOrderInput.parse(await readJson(req));
    return json(await reorderProductImages(db, actor, idParam.parse((await ctx.params).id), input.imageIds));
  });
}
