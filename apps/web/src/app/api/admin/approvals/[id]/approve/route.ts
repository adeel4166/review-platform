import { approveRequest } from "@/server/approvals";
import { handle, json } from "@/server/http";
import { clock, m6db, staffOf } from "@/server/m6-routes";
import { requireAdmin } from "@/server/session";
import { idParam } from "@/server/validation";

export const runtime = "nodejs";

/** Four-eyes approval (ADR-0026). Step-up is enforced inside approveRequest(); self-approval -> 403 approval_self. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireAdmin();
    return json(await approveRequest(m6db, staffOf(actor), idParam.parse((await ctx.params).id), clock));
  });
}
