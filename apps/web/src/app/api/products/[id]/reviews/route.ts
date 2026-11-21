import { db } from "@/server/db";
import { getStorage } from "@/server/storage";
import { handle, json, readJson } from "@/server/http";
import { createReview, listPublishedReviews } from "@/server/reviews";
import { requireUser } from "@/server/session";
import { idParam, reviewInput, reviewListQuery } from "@/server/validation";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const id = idParam.parse((await ctx.params).id);
    const q = reviewListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
    return json(await listPublishedReviews(db, id, q.page, q.pageSize, getStorage()));
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    const id = idParam.parse((await ctx.params).id);
    const input = reviewInput.parse(await readJson(req));
    return json(await createReview(db, actor.id, id, input), 201);
  });
}
