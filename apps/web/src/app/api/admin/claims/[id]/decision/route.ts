import { decideClaim } from "@/server/claims";
import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { requireAdmin } from "@/server/session";
import { claimDecisionInput, idParam } from "@/server/validation";

export const runtime = "nodejs";

/** approve / reject / request_info / revoke / spot_check_*. A staff member can never decide a claim they submitted. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const body = await readJson(req);
    const actor = await requireAdmin();
    return json(await decideClaim(db, actor, idParam.parse((await ctx.params).id), claimDecisionInput.parse(body)));
  });
}
