import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { removeReply } from "@/server/seller-replies";
import { requireAdmin } from "@/server/session";
import { idParam, replyRemoveInput } from "@/server/validation";

export const runtime = "nodejs";

/** Staff removal of a published seller reply (moderation.decide). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireAdmin();
    const id = idParam.parse((await ctx.params).id);
    return json(await removeReply(db, actor, id, replyRemoveInput.parse(await readJson(req))));
  });
}
