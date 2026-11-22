import { appealDeps } from "@/server/appeal-deps";
import { claimAppeal } from "@/server/appeals";
import { handle, json } from "@/server/http";
import { requireAdmin } from "@/server/session";
import { idParam } from "@/server/validation";

export const runtime = "nodejs";
/** A2: 15 min lease; the service refuses the appellant and anyone who decided the original (CONFLICT_OF_INTEREST). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => { const a = await requireAdmin(); return json(await claimAppeal(await appealDeps(), a.id, idParam.parse((await ctx.params).id))); });
}
