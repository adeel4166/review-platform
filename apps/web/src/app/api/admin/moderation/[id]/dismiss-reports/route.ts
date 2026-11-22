import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { dismissReports } from "@/server/reports";
import { requireAdmin } from "@/server/session";
import { dismissReportsInput, idParam } from "@/server/validation";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireAdmin();
    return json(await dismissReports(db, actor, idParam.parse((await ctx.params).id), dismissReportsInput.parse(await readJson(req).catch(() => ({})))));
  });
}
