import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { listModerationQueue } from "@/server/moderation";
import { requireAdmin } from "@/server/session";
import { moderationQueueQuery } from "@/server/validation";

export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const q = moderationQueueQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
    return json(await listModerationQueue(db, q));
  });
}
