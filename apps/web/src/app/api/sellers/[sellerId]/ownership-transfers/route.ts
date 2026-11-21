import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { createTransfer, listTransfers } from "@/server/ownership-transfers";
import { requireUser } from "@/server/session";
import { idParam, transferCreateInput } from "@/server/validation";

export const runtime = "nodejs";

/** OWNER lists open and recent ownership changes of THIS seller (seller id from the path). */
export async function GET(_req: Request, ctx: { params: Promise<{ sellerId: string }> }) {
  return handle(async () => json(await listTransfers(db, await requireUser(), idParam.parse((await ctx.params).sellerId))));
}

/** T1. 2FA gate + step-up are enforced in the service; the strict body cannot carry a seller id. */
export async function POST(req: Request, ctx: { params: Promise<{ sellerId: string }> }) {
  return handle(async () => {
    const raw = await readJson(req);
    const actor = await requireUser();
    const body = transferCreateInput.parse(raw);
    return json(await createTransfer(db, actor, idParam.parse((await ctx.params).sellerId), body), 201);
  });
}
