import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { decideMedia } from "@/server/admin-media";
import { requireAdmin } from "@/server/session";
import { getStorage } from "@/server/storage";
import { idParam, mediaDecisionInput } from "@/server/validation";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireAdmin();
    const input = mediaDecisionInput.parse(await readJson(req));
    return json(await decideMedia(db, getStorage(), actor, idParam.parse((await ctx.params).id), input.decision));
  });
}
