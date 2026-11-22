import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { createProofFileSlot } from "@/server/proofs";
import { limitUploadSlot } from "@/server/ratelimit";
import { requireUser } from "@/server/session";
import { getStorage } from "@/server/storage";
import { idParam, proofFileInput } from "@/server/validation";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    await limitUploadSlot(actor.id);
    const input = proofFileInput.parse(await readJson(req));
    return json(await createProofFileSlot(db, getStorage(), actor.id, idParam.parse((await ctx.params).id), input), 201);
  });
}
