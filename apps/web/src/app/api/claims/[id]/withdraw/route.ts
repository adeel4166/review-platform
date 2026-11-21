import { withdrawClaim } from "@/server/claims";
import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { isCrossOrigin } from "@/server/origin";
import { HttpError } from "@/server/http";
import { requireUser } from "@/server/session";
import { idParam } from "@/server/validation";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    if (isCrossOrigin(req)) throw new HttpError(403, "cross_origin", "Cross-origin request rejected");
    const actor = await requireUser();
    return json(await withdrawClaim(db, actor, idParam.parse((await ctx.params).id)));
  });
}
