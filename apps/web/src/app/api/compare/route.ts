import { db } from "@/server/db";
import { getImageResolver } from "@/server/storage";
import { compare } from "@/server/compare";
import { handle, json } from "@/server/http";
import { limitCompare } from "@/server/ratelimit";

export const runtime = "nodejs";
export async function GET(req: Request) {
  return handle(async () => { await limitCompare(req); return json(await compare(db, new URL(req.url).searchParams.get("ids"), undefined, getImageResolver())); });
}
