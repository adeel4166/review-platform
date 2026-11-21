import { getClaimForStaff } from "@/server/claims";
import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { requireAdmin } from "@/server/session";
import { idParam } from "@/server/validation";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin();
    return json(await getClaimForStaff(db, idParam.parse((await ctx.params).id)));
  });
}
