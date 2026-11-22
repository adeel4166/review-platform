import { limitReviewEdit, limitReviewWrite } from "@/server/ratelimit";
import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { deleteOwnReview, editOwnReview, updateOwnReview } from "@/server/reviews";
import { requireUser } from "@/server/session";
import { idParam, reviewEditInput, reviewUpdateInput } from "@/server/validation";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    await limitReviewWrite(req, actor.id);
    const id = idParam.parse((await ctx.params).id);
    const body = await readJson(req);
    // With `expectedVersion` the M4 contract applies (live edits of PUBLISHED reviews); without it the pre-M4 PENDING-only shape.
    if (body && typeof body === "object" && "expectedVersion" in body) {
      return json(await editOwnReview(db, actor.id, id, reviewEditInput.parse(body), { charge: async (live) => { if (live) await limitReviewEdit(actor.id); } }));
    }
    return json(await updateOwnReview(db, actor.id, id, reviewUpdateInput.parse(body)));
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    await deleteOwnReview(db, actor.id, idParam.parse((await ctx.params).id));
    return new Response(null, { status: 204 });
  });
}
