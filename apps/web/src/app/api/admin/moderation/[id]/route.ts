import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { getCaseDetail } from "@/server/moderation";
import { requireAdmin } from "@/server/session";
import { getStorage } from "@/server/storage";
import { idParam } from "@/server/validation";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin();
    return json(await getCaseDetail(db, getStorage(), idParam.parse((await ctx.params).id)));
  });
}
