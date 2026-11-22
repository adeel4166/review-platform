import { db } from "@/server/db";
import { handle } from "@/server/http";
import { blockUser, unblockUser } from "@/server/social";
import { requireUser } from "@/server/session";
import { idParam } from "@/server/validation";

export const runtime = "nodejs";
export async function PUT(_req: Request, ctx: { params: Promise<{ userId: string }> }) {
  return handle(async () => { const a = await requireUser(); await blockUser(db, a.id, idParam.parse((await ctx.params).userId)); return new Response(null, { status: 204 }); });
}
export async function DELETE(_req: Request, ctx: { params: Promise<{ userId: string }> }) {
  return handle(async () => { const a = await requireUser(); await unblockUser(db, a.id, idParam.parse((await ctx.params).userId)); return new Response(null, { status: 204 }); });
}
