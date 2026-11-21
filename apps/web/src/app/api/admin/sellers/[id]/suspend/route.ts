import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { suspendSeller } from "@/server/sellers";
import { requireAdmin } from "@/server/session";
import { idParam, sellerSuspendInput } from "@/server/validation";

export const runtime = "nodejs";

/** SELLER_SUSPENSION removes every seller permission for all members (AZ-007). ADMIN tier. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireAdmin();
    const id = idParam.parse((await ctx.params).id);
    return json(await suspendSeller(db, actor, id, sellerSuspendInput.parse(await readJson(req))), 201);
  });
}
