import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { confirmProofFile } from "@/server/proofs";
import { requireUser } from "@/server/session";
import { idParam } from "@/server/validation";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; fileId: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    const p = await ctx.params;
    return json(await confirmProofFile(db, actor.id, idParam.parse(p.id), idParam.parse(p.fileId)), 202);
  });
}
