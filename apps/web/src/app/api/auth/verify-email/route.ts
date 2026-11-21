import { z } from "zod";
import { db } from "@/server/db";
import { verifyEmailToken } from "@/server/email-verification";
import { handle, json, readJson } from "@/server/http";
import { limitVerifyEmail } from "@/server/ratelimit";

export const runtime = "nodejs";

const input = z.object({ token: z.string().min(20).max(128) }).strict();

export async function POST(req: Request) {
  return handle(async () => {
    await limitVerifyEmail(req);
    const { token } = input.parse(await readJson(req));
    await verifyEmailToken(db as never, token);
    return json({ status: "verified" });
  });
}
