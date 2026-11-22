import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { decideProductImage } from "@/server/product-images";
import { requireAdmin } from "@/server/session";
import { idParam, productImageDecisionInput } from "@/server/validation";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireAdmin();
    const input = productImageDecisionInput.parse(await readJson(req));
    return json(await decideProductImage(db, actor, idParam.parse((await ctx.params).id), input.decision));
  });
}
