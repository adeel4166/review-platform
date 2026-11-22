import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { rejectReport } from "@/server/reports";
import { requireAdmin } from "@/server/session";
import { idParam } from "@/server/validation";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => json(await rejectReport(db, await requireAdmin(), idParam.parse((await ctx.params).id))));
}
