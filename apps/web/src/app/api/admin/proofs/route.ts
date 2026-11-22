import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { listProofQueue } from "@/server/proofs";
import { requireAdmin } from "@/server/session";
import { pageQuery } from "@/server/validation";

export async function GET(req: Request) {
  return handle(async () => {
    const actor = await requireAdmin();
    const q = pageQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
    return json(await listProofQueue(db, actor, q.page, q.pageSize));
  });
}
