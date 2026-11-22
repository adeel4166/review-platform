import { db } from "@/server/db";
import { listErasures } from "@/server/account-erasure";
import { handle, json } from "@/server/http";
import { requireAdmin } from "@/server/session";

export const runtime = "nodejs";

/** GET /api/admin/erasures (ADMIN, status only). */
export function GET() {
  return handle(async () => { await requireAdmin(); return json({ items: await listErasures(db) }); });
}
