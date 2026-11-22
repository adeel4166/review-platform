import { z } from "zod";
import { handle, json, readJson } from "@/server/http";
import { requestOriginalAccess } from "@/server/break-glass";
import { alert, clock, m6db, staffOf } from "@/server/m6-routes";
import { requireAdmin } from "@/server/session";
import { idParam } from "@/server/validation";

export const runtime = "nodejs";

const input = z.object({ reasonCode: z.string().min(1).max(32), reasonText: z.string().max(2000) }).strict();

/** Break-glass `proof.view_original` (ADR-0027): reason + step-up + daily cap; writes the audit row; returns a 60 s single-use access. */
export async function POST(req: Request, ctx: { params: Promise<{ proofId: string; fileId: string }> }) {
  return handle(async () => {
    const actor = await requireAdmin();
    const p = await ctx.params;
    const body = input.parse(await readJson(req));
    const r = await requestOriginalAccess(m6db, staffOf(actor), { proofId: idParam.parse(p.proofId), fileId: idParam.parse(p.fileId), ...body }, clock, alert);
    return json(r, r.status);
  });
}
