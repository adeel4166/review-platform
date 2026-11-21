import { denyBusinessEmail } from "@/server/claim-email";
import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { limitTokenLink } from "@/server/ratelimit";
import { claimEmailTokenInput } from "@/server/validation";

export const runtime = "nodejs";

/** "This wasn't me": no sign-in, the mailbox holder's veto. 10/min per IP. */
export async function POST(req: Request) {
  return handle(async () => {
    const { token } = claimEmailTokenInput.parse(await readJson(req));
    await limitTokenLink(req);
    return json(await denyBusinessEmail(db, token));
  });
}
