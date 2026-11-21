import { db } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { requireSuperAdmin, requireStepUp } from "@/server/session";
import { grantStaffRole, revokeStaffRole } from "@/server/staff-roles";
import { idParam, staffRoleInput, staffRoleRevokeInput } from "@/server/validation";

export const runtime = "nodejs";

/** Staff role management is SUPER_ADMIN-only (ADR-0003, SEC-09e). ADMIN gets 403. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = requireStepUp(await requireSuperAdmin());
    const id = idParam.parse((await ctx.params).id);
    const body = staffRoleInput.parse(await readJson(req));
    return json(await grantStaffRole(db, actor, id, body.role, body.reason), 201);
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
