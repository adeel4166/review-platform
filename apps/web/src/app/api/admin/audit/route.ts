import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { listAudit } from "@/server/moderation";
import { requireAdmin } from "@/server/session";
import { auditQuery } from "@/server/validation";

export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin();
    return json(await listAudit(db, auditQuery.parse(Object.fromEntries(new URL(req.url).searchParams))));
  });
}
