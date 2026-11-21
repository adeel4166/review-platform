import { uploadSlotInput } from "@rp/core";
import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { createUploadSlot, listOwnMedia } from "@/server/media";
import { requireUser } from "@/server/session";
import { getStorage } from "@/server/storage";
import { idParam } from "@/server/validation";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    return json(await listOwnMedia(db, actor.id, idParam.parse((await ctx.params).id)));
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    const id = idParam.parse((await ctx.params).id);
    const input = uploadSlotInput.parse(await readJson(req));
    return json(await createUploadSlot(db, getStorage(), actor.id, id, input), 201);
  });
}
