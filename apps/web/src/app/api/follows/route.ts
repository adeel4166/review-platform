import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { limitFollow } from "@/server/ratelimit";
import { followInput, putFollow } from "@/server/social";
import { requireUser } from "@/server/session";

export const runtime = "nodejs";
export async function PUT(req: Request) {
  return handle(async () => { const a = await requireUser(); return json(await putFollow(db, a.id, followInput.parse(await readJson(req)), () => limitFollow(a.id))); });
}
