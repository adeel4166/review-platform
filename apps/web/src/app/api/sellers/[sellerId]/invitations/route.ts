import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { inviteMember } from "@/server/sellers";
import { requireUser } from "@/server/session";
import { idParam, invitationInput } from "@/server/validation";

export const runtime = "nodejs";

/** The seller comes from the path resource; the body is strict and cannot name a seller. */
export async function POST(req: Request, ctx: { params: Promise<{ sellerId: string }> }) {
  return handle(async () => {
    const body = await readJson(req);
    const actor = await requireUser();
    const sellerId = idParam.parse((await ctx.params).sellerId);
    return json(await inviteMember(db, actor, sellerId, invitationInput.parse(body)), 201);
  });
}
