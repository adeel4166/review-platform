import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { revokeInvitation } from "@/server/sellers";
import { requireUser } from "@/server/session";
import { idParam } from "@/server/validation";

export const runtime = "nodejs";

/** Revoke. The seller scope is derived from the invitation row (AZ-010), not from the URL or body. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await readJson(req).catch(() => undefined);
    const actor = await requireUser();
    return json(await revokeInvitation(db, actor, idParam.parse((await ctx.params).id)));
  });
}
