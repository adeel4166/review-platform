import { limitReviewWrite } from "@/server/ratelimit";
import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { deleteOwnReview, updateOwnReview } from "@/server/reviews";
import { requireUser } from "@/server/session";
import { idParam, reviewUpdateInput } from "@/server/validation";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    await limitReviewWrite(req, actor.id);
    const id = idParam.parse((await ctx.params).id);
    const patch = reviewUpdateInput.parse(await readJson(req));
    return json(await updateOwnReview(db, actor.id, id, patch));
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    await deleteOwnReview(db, actor.id, idParam.parse((await ctx.params).id));
    return new Response(null, { status: 204 });
  });
}
