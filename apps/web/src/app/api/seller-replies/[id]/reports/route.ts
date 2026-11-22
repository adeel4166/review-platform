import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { hashIp, ipOf, limitReport } from "@/server/ratelimit";
import { createReport } from "@/server/reports";
import { requireVerifiedUser } from "@/server/verified-user";
import { idParam, reportInput } from "@/server/validation";

export const runtime = "nodejs";

/** 202 for new and repeated reports alike. `details` is stored as typed and never logged or queued. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireVerifiedUser();
    const input = reportInput.parse(await readJson(req));
    const ipHash = hashIp(ipOf(req));
    return json(await createReport(db, actor.id, { sellerReplyId: idParam.parse((await ctx.params).id) }, input, { ipHash, charge: () => limitReport(actor.id, ipHash) }), 202);
  });
}
