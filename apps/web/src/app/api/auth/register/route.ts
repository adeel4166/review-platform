import { limitRegister } from "@/server/ratelimit";
import { hashPassword } from "@rp/db";
import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { registerAccount } from "@/server/registration";
import { registerInput } from "@/server/validation";

export const runtime = "nodejs";

/** SEC-05: 202 {"status":"verification_sent"} for a new and an existing email alike; no session is created. */
export async function POST(req: Request) {
  return handle(async () => {
    await limitRegister(req); // before the argon2 hash (SEC-03)
    const input = registerInput.parse(await readJson(req));
    return json(await registerAccount(db as never, input, hashPassword), 202);
  });
}
