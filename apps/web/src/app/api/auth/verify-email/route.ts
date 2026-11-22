import { systemClock } from "@rp/core";
import { z } from "zod";
import { hashPassword } from "@rp/db";
import { db } from "@/server/db";
import { verifyEmailToken } from "@/server/email-verification";
import { handle, json, readJson } from "@/server/http";
import { limitVerifyEmail } from "@/server/ratelimit";

export const runtime = "nodejs";

const input = z.object({ token: z.string().min(20).max(128), newPassword: z.string().min(10).max(128) }).strict();

export async function POST(req: Request) {
  return handle(async () => {
    await limitVerifyEmail(req);
    const { token, newPassword } = input.parse(await readJson(req));
    await verifyEmailToken(db as never, token, systemClock.now(), await hashPassword(newPassword));
    return json({ status: "verified" });
  });
}
