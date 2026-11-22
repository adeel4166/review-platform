import { db } from "@/server/db";
import { handle } from "@/server/http";
import { deleteFollow } from "@/server/social";
import { requireUser } from "@/server/session";
import { idParam } from "@/server/validation";

export const runtime = "nodejs";
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => { const a = await requireUser(); await deleteFollow(db, a.id, idParam.parse((await ctx.params).id)); return new Response(null, { status: 204 }); });
}
