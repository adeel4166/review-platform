import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { staffCancelTransfer } from "@/server/ownership-transfers";
import { requireAdmin } from "@/server/session";
import { idParam, transferStaffCancelInput } from "@/server/validation";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const raw = await readJson(req);
    const actor = await requireAdmin();
    const { reasonCode } = transferStaffCancelInput.parse(raw);
    return json(await staffCancelTransfer(db, actor, idParam.parse((await ctx.params).id), reasonCode));
  });
}
