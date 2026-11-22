import { requestConfigActivation } from "@/server/approvals";
import { handle, json } from "@/server/http";
import { clock, m6db, staffOf } from "@/server/m6-routes";
import { requireAdmin } from "@/server/session";

export const runtime = "nodejs";

/** CFG-004: activation is a request; a second ADMIN approves it through /api/admin/approvals/:id/approve. */
export async function POST(_req: Request, ctx: { params: Promise<{ version: string }> }) {
  return handle(async () => {
    const actor = await requireAdmin();
    return json(await requestConfigActivation(m6db, staffOf(actor), (await ctx.params).version.slice(0, 32), clock), 202);
  });
}
