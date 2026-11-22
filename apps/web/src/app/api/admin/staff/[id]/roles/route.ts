import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { requireSuperAdmin, requireStepUp } from "@/server/session";
import { requestRoleGrant } from "@/server/approvals";
import { clock, m6db, staffOf } from "@/server/m6-routes";
import { revokeStaffRole } from "@/server/staff-roles";
import { idParam, staffRoleInput, staffRoleRevokeInput } from "@/server/validation";

export const runtime = "nodejs";

/** Grants go through the four-eyes service (SEC-M6-01): the route stays SUPER_ADMIN-only (ADR-0003, SEC-09e); MODERATOR is single-actor (201), other roles return 202 and need a second SUPER_ADMIN. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = requireStepUp(await requireSuperAdmin());
    const id = idParam.parse((await ctx.params).id);
    const body = staffRoleInput.parse(await readJson(req));
    const r = await requestRoleGrant(m6db, staffOf(actor), id, body.role, body.reason, clock);
    return json(r, r.status);
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = requireStepUp(await requireSuperAdmin());
    const id = idParam.parse((await ctx.params).id);
    const body = staffRoleRevokeInput.parse(await readJson(req));
    return json(await revokeStaffRole(db, actor, id, body.role));
  });
}
