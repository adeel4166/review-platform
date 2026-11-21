import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { unsuspendSeller } from "@/server/sellers";
import { requireAdmin } from "@/server/session";
import { idParam } from "@/server/validation";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireAdmin();
    await readJson(req).catch(() => undefined);
    return json(await unsuspendSeller(db, actor, idParam.parse((await ctx.params).id)));
  });
}
