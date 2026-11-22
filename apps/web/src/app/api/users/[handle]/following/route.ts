import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { limitPublicRead } from "@/server/ratelimit";
import { listFollowers } from "@/server/social";
import { optionalUserId } from "@/server/viewer";

export const runtime = "nodejs";
export async function GET(req: Request, ctx: { params: Promise<{ handle: string }> }) {
  return handle(async () => {
    await limitPublicRead(req);
    return json(await listFollowers(db, (await ctx.params).handle, await optionalUserId(), "following", new URL(req.url).searchParams.get("cursor") ?? undefined));
  });
}
