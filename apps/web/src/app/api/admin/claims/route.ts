import { listClaimQueue } from "@/server/claims";
import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { requireAdmin } from "@/server/session";
import { claimQueueQuery } from "@/server/validation";

export const runtime = "nodejs";

/** Ownership-claim staff queue (`seller.claim.review`, ADMIN tier). Tabs: review, contested, spot_check. */
export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const q = claimQueueQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
    return json(await listClaimQueue(db, q.tab, q));
  });
}
