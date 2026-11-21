import { db } from "@/server/db";
import { resendVerification } from "@/server/email-verification";
import { handle, json, readJson } from "@/server/http";
import { limitVerifyEmail } from "@/server/ratelimit";
import { requireUser } from "@/server/session";

export const runtime = "nodejs";

/** 202 always for a signed-in unverified user, whether queued or throttled (no feedback to abusers). */
export async function POST(req: Request) {
  return handle(async () => {
    await readJson(req).catch(() => undefined); // Origin/content-type checks
    const actor = await requireUser();
    await limitVerifyEmail(req);
    await resendVerification(db as never, actor.id);
    return json({ status: "verification_sent" }, 202);
  });
}
