import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { hashIp, ipOf, limitVote } from "@/server/ratelimit";
import { deleteVote, putVote } from "@/server/votes";
import { requireVerifiedUser } from "@/server/verified-user";
import { idParam, voteInput } from "@/server/validation";

export const runtime = "nodejs";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireVerifiedUser();
    const { value } = voteInput.parse(await readJson(req));
    const ipHash = hashIp(ipOf(req));
    return json(await putVote(db, actor.id, idParam.parse((await ctx.params).id), value, { ipHash, charge: ({ newAccount }) => limitVote(actor.id, ipHash, newAccount) }));
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireVerifiedUser();
    const ipHash = hashIp(ipOf(req));
    return json(await deleteVote(db, actor.id, idParam.parse((await ctx.params).id), { ipHash, charge: ({ newAccount }) => limitVote(actor.id, ipHash, newAccount) }));
  });
}
