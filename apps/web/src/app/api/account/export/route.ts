import { db } from "@/server/db";
import { exportOwnData } from "@/server/account-erasure";
import { handle, json } from "@/server/http";
import { limitAccountExport } from "@/server/ratelimit";
import { requireUser } from "@/server/session";

export const runtime = "nodejs";

/** GET /api/account/export: the caller's own data as JSON, 1/day. */
export function GET() {
  return handle(async () => {
    const a = await requireUser();
    await limitAccountExport(a.id);
    return json(await exportOwnData(db, a.id));
  });
}
