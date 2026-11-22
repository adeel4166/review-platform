import { appealDeps } from "@/server/appeal-deps";
import { getOwnAppeal, withdrawAppeal } from "@/server/appeals";
import { handle, json } from "@/server/http";
import { requireUser } from "@/server/session";
import { idParam } from "@/server/validation";

export const runtime = "nodejs";
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => { const u = await requireUser(); const d = await appealDeps(); return json(await getOwnAppeal(d.db, u.id, idParam.parse((await ctx.params).id))); });
}
/** Withdraw (11.4). The appellant is the session user only. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => { const u = await requireUser(); return json(await withdrawAppeal(await appealDeps(), u.id, idParam.parse((await ctx.params).id))); });
}
