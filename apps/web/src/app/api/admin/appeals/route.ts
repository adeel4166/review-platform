import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { clock } from "@/server/m6-routes";
import { listAppealQueue } from "@/server/m6-ui";
import { requireAdmin } from "@/server/session";

export const runtime = "nodejs";
export async function GET() { return handle(async () => { const a = await requireAdmin(); return json(await listAppealQueue(db, a.id, clock.now())); }); }
