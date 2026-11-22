import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { createProductImageSlot, listProductImagesForManager } from "@/server/product-images";
import { limitUploadSlot, rateConfig } from "@/server/ratelimit";
import { requireUser } from "@/server/session";
import { getStorage } from "@/server/storage";
import { idParam, productImageSlotInput } from "@/server/validation";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    return json(await listProductImagesForManager(db, actor, idParam.parse((await ctx.params).id), getStorage()));
  });
}

/** Returns a presigned PUT; the client then calls POST /api/media/:assetId/confirm (same flow as review media). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    await limitUploadSlot(actor.id);
    const id = idParam.parse((await ctx.params).id);
    const input = productImageSlotInput.parse(await readJson(req));
    return json(await createProductImageSlot(db, getStorage(), actor, id, input, rateConfig().MEDIA_DAILY_QUOTA), 201);
  });
}
