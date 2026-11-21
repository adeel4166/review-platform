import { verifyBusinessEmail } from "@/server/claim-email";
import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { limitVerifyEmail } from "@/server/ratelimit";
import { requireUser } from "@/server/session";
import { claimEmailTokenInput } from "@/server/validation";

export const runtime = "nodejs";

/** Consumes the token for the SESSION user only (m3b-spec 4.4). The token is in the body, never the URL. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const actor = await requireUser();
    const { token } = claimEmailTokenInput.parse(body);
    await limitVerifyEmail(req);
    return json(await verifyBusinessEmail(db, actor, token));
  });
}
