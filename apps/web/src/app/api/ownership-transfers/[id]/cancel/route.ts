import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { cancelTransfer } from "@/server/ownership-transfers";
import { requireUser } from "@/server/session";
import { idParam } from "@/server/validation";

export const runtime = "nodejs";

/** Protective: no 2FA gate and no step-up (ADR-0020). Authorization is party/OWNER membership in the service. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await readJson(req).catch(() => undefined);
    return json(await cancelTransfer(db, await requireUser(), idParam.parse((await ctx.params).id)));
  });
}
