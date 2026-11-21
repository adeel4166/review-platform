import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { acceptTransfer } from "@/server/ownership-transfers";
import { requireUser } from "@/server/session";
import { idParam } from "@/server/validation";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await readJson(req).catch(() => undefined);
    return json(await acceptTransfer(db, await requireUser(), idParam.parse((await ctx.params).id)));
  });
}
