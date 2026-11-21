import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { decideCase } from "@/server/moderation";
import { requireAdmin } from "@/server/session";
import { idParam, approveInput } from "@/server/validation";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireAdmin();
    const id = idParam.parse((await ctx.params).id);
    const body = approveInput.parse(await readJson(req));
    return json(await decideCase(db, actor, id, "APPROVED", body.reason));
  });
}
