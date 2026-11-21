import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { cancelByLink } from "@/server/ownership-transfers";
import { limitTokenLink } from "@/server/ratelimit";
import { transferTokenInput } from "@/server/validation";

export const runtime = "nodejs";

/** No sign-in: the unused cancel token is the credential. Same 400 for every failure. */
export async function POST(req: Request) {
  return handle(async () => {
    const { token } = transferTokenInput.parse(await readJson(req));
    await limitTokenLink(req);
    return json(await cancelByLink(db, token));
  });
}
