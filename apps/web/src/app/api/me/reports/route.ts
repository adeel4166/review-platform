import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { listMyReports } from "@/server/reports";
import { requireUser } from "@/server/session";

export async function GET() {
  return handle(async () => json(await listMyReports(db, (await requireUser()).id)));
}
