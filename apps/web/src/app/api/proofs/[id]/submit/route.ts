import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { submitProof } from "@/server/proofs";
import { requireUser } from "@/server/session";
import { idParam } from "@/server/validation";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => json(await submitProof(db, (await requireUser()).id, idParam.parse((await ctx.params).id))));
}
