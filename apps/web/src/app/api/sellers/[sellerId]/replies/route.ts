import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { listSellerReplies } from "@/server/seller-replies";
import { requireUser } from "@/server/session";
import { idParam, replyListQuery } from "@/server/validation";

export const runtime = "nodejs";

/** Dashboard list for members of the seller in the path (non-members get 404). */
export async function GET(req: Request, ctx: { params: Promise<{ sellerId: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    const sellerId = idParam.parse((await ctx.params).sellerId);
    const q = replyListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
    return json(await listSellerReplies(db, actor, sellerId, q));
  });
}
