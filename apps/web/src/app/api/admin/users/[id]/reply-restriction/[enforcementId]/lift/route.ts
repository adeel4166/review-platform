import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { liftReplyRestriction } from "@/server/seller-replies";
import { requireAdmin, requireStepUp } from "@/server/session";
import { idParam } from "@/server/validation";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; enforcementId: string }> }) {
  return handle(async () => {
    const actor = requireStepUp(await requireAdmin());
    const p = await ctx.params;
    idParam.parse(p.id);
    return json(await liftReplyRestriction(db, actor, idParam.parse(p.enforcementId)));
  });
}
