import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { limitVerifyEmail } from "@/server/ratelimit";
import { acceptInvitation } from "@/server/sellers";
import { invitationAcceptInput } from "@/server/validation";
import { requireVerifiedUser } from "@/server/verified-user";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const actor = await requireVerifiedUser();
    await limitVerifyEmail(req);
    return json(await acceptInvitation(db, actor, invitationAcceptInput.parse(body).token));
  });
}
