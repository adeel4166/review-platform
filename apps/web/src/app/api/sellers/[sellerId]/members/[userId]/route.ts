import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { removeMember } from "@/server/sellers";
import { requireUser } from "@/server/session";
import { idParam } from "@/server/validation";

export const runtime = "nodejs";

/** OWNER removes a member, or a member leaves (userId = self). The last OWNER cannot be removed. */
export async function DELETE(req: Request, ctx: { params: Promise<{ sellerId: string; userId: string }> }) {
  return handle(async () => {
    await readJson(req).catch(() => undefined); // Origin check; no body expected
    const actor = await requireUser();
    const p = await ctx.params;
    return json(await removeMember(db, actor, idParam.parse(p.sellerId), idParam.parse(p.userId)));
  });
}
