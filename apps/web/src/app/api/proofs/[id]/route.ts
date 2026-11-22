import { db } from "@/server/db";
import { handle } from "@/server/http";
import { withdrawProof } from "@/server/proofs";
import { requireUser } from "@/server/session";
import { idParam } from "@/server/validation";

/** DRAFT/PENDING -> WITHDRAWN; files purged within 24 h; a VERIFIED label stays. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await withdrawProof(db, (await requireUser()).id, idParam.parse((await ctx.params).id));
    return new Response(null, { status: 204 });
  });
}
