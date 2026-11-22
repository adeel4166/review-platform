import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { getOwnProfile, patchOwnProfile, profilePatch } from "@/server/social";
import { requireUser } from "@/server/session";

export const runtime = "nodejs";
export async function GET() { return handle(async () => json(await getOwnProfile(db, (await requireUser()).id))); }
export async function PATCH(req: Request) {
  return handle(async () => { const a = await requireUser(); return json(await patchOwnProfile(db, a.id, profilePatch.parse(await readJson(req)))); });
}
