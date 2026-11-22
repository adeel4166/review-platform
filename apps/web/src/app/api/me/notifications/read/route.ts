import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { markRead, readInput } from "@/server/notifications";
import { requireUser } from "@/server/session";

export const runtime = "nodejs";
export async function POST(req: Request) {
  return handle(async () => { const a = await requireUser(); return json(await markRead(db, a.id, readInput.parse(await readJson(req)))); });
}
