import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { confirmUpload } from "@/server/media";
import { requireUser } from "@/server/session";
import { getStorage } from "@/server/storage";
import { idParam } from "@/server/validation";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    return json(await confirmUpload(db, getStorage(), actor.id, idParam.parse((await ctx.params).id)), 202);
  });
}
