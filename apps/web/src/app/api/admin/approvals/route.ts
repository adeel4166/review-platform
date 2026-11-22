import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { clock } from "@/server/m6-routes";
import { listPendingApprovals } from "@/server/m6-ui";
import { requireAdmin } from "@/server/session";

export const runtime = "nodejs";
export async function GET() { return handle(async () => { await requireAdmin(); return json(await listPendingApprovals(db, clock.now())); }); }
