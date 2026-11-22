import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { removeProductImage, updateProductImage } from "@/server/product-images";
import { requireUser } from "@/server/session";
import { idParam, productImagePatchInput } from "@/server/validation";

type Ctx = { params: Promise<{ id: string; imageId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const actor = await requireUser();
    const p = await ctx.params;
    return json(await updateProductImage(db, actor, idParam.parse(p.id), idParam.parse(p.imageId), productImagePatchInput.parse(await readJson(req))));
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const actor = await requireUser();
    const p = await ctx.params;
    return json(await removeProductImage(db, actor, idParam.parse(p.id), idParam.parse(p.imageId)));
  });
}
