import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { getPreferences, prefInput, putPreference } from "@/server/notifications";
import { requireUser } from "@/server/session";

export const runtime = "nodejs";
export async function GET() { return handle(async () => json({ items: await getPreferences(db, (await requireUser()).id) })); }
export async function PUT(req: Request) {
  return handle(async () => { const a = await requireUser(); return json(await putPreference(db, a.id, prefInput.parse(await readJson(req)))); });
}
