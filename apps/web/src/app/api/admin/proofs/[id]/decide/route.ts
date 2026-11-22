import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { decideProof } from "@/server/proofs";
import { requireAdmin } from "@/server/session";
import { idParam, proofDecisionInput } from "@/server/validation";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireAdmin();
    return json(await decideProof(db, actor, idParam.parse((await ctx.params).id), proofDecisionInput.parse(await readJson(req))));
  });
}
