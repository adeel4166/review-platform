import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { createProof, listOwnProofs } from "@/server/proofs";
import { limitProofCreate } from "@/server/ratelimit";
import { requireUser } from "@/server/session";
import { requireVerifiedUser } from "@/server/verified-user";
import { idParam, proofCreateInput } from "@/server/validation";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireVerifiedUser();
    const input = proofCreateInput.parse(await readJson(req));
    return json(await createProof(db, actor.id, idParam.parse((await ctx.params).id), input, { charge: () => limitProofCreate(actor.id) }), 201);
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => json(await listOwnProofs(db, (await requireUser()).id, idParam.parse((await ctx.params).id))));
}
