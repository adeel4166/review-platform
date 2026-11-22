import { z } from "zod";
import { db } from "@/server/db";
import { requestAccountErasure } from "@/server/account-erasure";
import { handle, json, readJson } from "@/server/http";
import { requireStepUp, requireUser } from "@/server/session";

export const runtime = "nodejs";
const input = z.object({ confirm: z.string().min(1).max(64) }).strict();

/** DELETE /api/account {confirm: "<handle>"} (step-up) -> 202 {erasureRequestId}; the worker job `account.erase` does the purge (ADR-0033). */
export function DELETE(req: Request) {
  return handle(async () => {
    const a = requireStepUp(await requireUser());
    const body = input.parse(await readJson(req));
    return json(await requestAccountErasure(db, a.id, body.confirm), 202);
  });
}
