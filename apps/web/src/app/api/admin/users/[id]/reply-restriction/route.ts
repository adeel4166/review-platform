import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { issueReplyRestriction } from "@/server/seller-replies";
import { requireAdmin, requireStepUp } from "@/server/session";
import { idParam, replyRestrictionInput } from "@/server/validation";

export const runtime = "nodejs";

/** SELLER_REPLY_RESTRICTION (ADMIN, 2FA staff gate, step-up). Blocks reply create and edit, not delete. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = requireStepUp(await requireAdmin());
    const id = idParam.parse((await ctx.params).id);
    return json(await issueReplyRestriction(db, actor, { userId: id }, replyRestrictionInput.parse(await readJson(req))), 201);
  });
}
