import { z } from "zod";
import { rejectOrCancel } from "@/server/approvals";
import { handle, json, readJson } from "@/server/http";
import { clock, m6db, staffOf } from "@/server/m6-routes";
import { requireAdmin } from "@/server/session";
import { idParam } from "@/server/validation";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireAdmin();
    const body = z.object({ note: z.string().max(500).optional() }).strict().parse(await readJson(req));
    return json(await rejectOrCancel(m6db, staffOf(actor), idParam.parse((await ctx.params).id), "reject", body.note, clock));
  });
}
