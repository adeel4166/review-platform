import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { limitPublicRead } from "@/server/ratelimit";
import { listUserReviews } from "@/server/social";
import { optionalUserId } from "@/server/viewer";

export const runtime = "nodejs";
export async function GET(req: Request, ctx: { params: Promise<{ handle: string }> }) {
  return handle(async () => {
    await limitPublicRead(req);
    const q = new URL(req.url).searchParams;
    return json(await listUserReviews(db, (await ctx.params).handle, await optionalUserId(), { verified: q.get("verified") === "true", sort: q.get("sort") === "helpful" ? "helpful" : "recent" }));
  });
}
