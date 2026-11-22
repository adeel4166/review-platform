import { z } from "zod";
import { appealDeps } from "@/server/appeal-deps";
import { decideAppeal } from "@/server/appeals";
import { handle, json, readJson } from "@/server/http";
import { requireAdmin } from "@/server/session";
import { idParam } from "@/server/validation";

export const runtime = "nodejs";
const input = z.object({ outcome: z.enum(["UPHELD", "OVERTURNED", "PARTIALLY_OVERTURNED"]), decisionNote: z.string().trim().min(1).max(2000) }).strict();
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const a = await requireAdmin();
    const r = await decideAppeal(await appealDeps(), a.id, idParam.parse((await ctx.params).id), input.parse(await readJson(req)));
    return json(r, r.status);
  });
}
