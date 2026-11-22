import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { revokeVerifiedLabel } from "@/server/proofs";
import { requireAdmin, requireStepUp } from "@/server/session";
import { idParam, labelRevokeInput } from "@/server/validation";

/** Admin tier + a step-up within 10 minutes (PRV-013). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = requireStepUp(await requireAdmin());
    return json(await revokeVerifiedLabel(db, actor, idParam.parse((await ctx.params).id), labelRevokeInput.parse(await readJson(req))));
  });
}
