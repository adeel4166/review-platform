import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { listNotifications, listQuery } from "@/server/notifications";
import { requireUser } from "@/server/session";

export const runtime = "nodejs";
export async function GET(req: Request) {
  return handle(async () => {
    const a = await requireUser();
    return json(await listNotifications(db, a.id, listQuery.parse(Object.fromEntries(new URL(req.url).searchParams))));
  });
}
