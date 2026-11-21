import { submitClaim } from "@/server/claims";
import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { requireUser } from "@/server/session";
import { claimSubmitInput, idParam } from "@/server/validation";

export const runtime = "nodejs";

/** The seller comes from the path; the strict body cannot name a seller (AZ-010). */
export async function POST(req: Request, ctx: { params: Promise<{ sellerId: string }> }) {
  return handle(async () => {
    const body = await readJson(req);
    const actor = await requireUser();
    const sellerId = idParam.parse((await ctx.params).sellerId);
    return json(await submitClaim(db, actor, sellerId, claimSubmitInput.parse(body)), 201);
  });
}
