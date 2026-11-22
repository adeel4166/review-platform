import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { getProofDetail } from "@/server/proofs";
import { requireAdmin } from "@/server/session";
import { getStorage } from "@/server/storage";
import { idParam } from "@/server/validation";

/** Redacted pages only, one audit row per view. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireAdmin(); // authenticate before touching storage config
    return json(await getProofDetail(db, getStorage(), actor, idParam.parse((await ctx.params).id)));
  });
}
