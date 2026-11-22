import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { removeReportedContent } from "@/server/reports";
import { requireAdmin } from "@/server/session";
import { idParam, removeContentInput } from "@/server/validation";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireAdmin();
    return json(await removeReportedContent(db, actor, idParam.parse((await ctx.params).id), removeContentInput.parse(await readJson(req))));
  });
}
