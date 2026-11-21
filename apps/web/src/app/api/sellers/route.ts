import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { createSeller } from "@/server/sellers";
import { sellerCreateInput } from "@/server/validation";
import { requireVerifiedUser } from "@/server/verified-user";

export const runtime = "nodejs";

/** Create a seller (verified email required). The creator becomes its OWNER. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const actor = await requireVerifiedUser();
    return json(await createSeller(db, actor, sellerCreateInput.parse(body)), 201);
  });
}
