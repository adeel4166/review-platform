import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { listRevisions } from "@/server/reviews";
import { requireUser } from "@/server/session";
import { idParam } from "@/server/validation";

/** Author and staff only; everyone else gets the same 404 as for a missing review (AZ-022). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => json(await listRevisions(db, await requireUser(), idParam.parse((await ctx.params).id))));
}
