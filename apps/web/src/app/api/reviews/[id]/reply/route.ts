import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { limitReplyCreate } from "@/server/ratelimit";
import { createReply } from "@/server/seller-replies";
import { requireVerifiedUser } from "@/server/verified-user";
import { idParam, replyInput } from "@/server/validation";

export const runtime = "nodejs";

/** The review id is the path; the seller is derived server-side from review -> product -> seller (P-2). The body is `{body}` only. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireVerifiedUser(); // authenticate before reading the body
    const input = replyInput.parse(await readJson(req));
    const reviewId = idParam.parse((await ctx.params).id);
    return json(await createReply(db, actor, reviewId, input, { rateLimit: ({ sellerId }) => limitReplyCreate(actor.id, sellerId) }), 201);
  });
}
