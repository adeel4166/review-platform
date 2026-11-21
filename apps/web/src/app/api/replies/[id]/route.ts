import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { limitReplyEdit } from "@/server/ratelimit";
import { deleteReply, editReply } from "@/server/seller-replies";
import { requireVerifiedUser } from "@/server/verified-user";
import { idParam, replyInput } from "@/server/validation";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireVerifiedUser(); // authenticate before reading the body
    const input = replyInput.parse(await readJson(req));
    const id = idParam.parse((await ctx.params).id);
    return json(await editReply(db, actor, id, input, { rateLimit: ({ replyId }) => limitReplyEdit(replyId!) }));
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireVerifiedUser();
    const id = idParam.parse((await ctx.params).id);
    return json(await deleteReply(db, actor, id));
  });
}
