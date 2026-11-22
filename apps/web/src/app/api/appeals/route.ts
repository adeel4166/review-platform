import { z } from "zod";
import { fileAppeal, type AppealDeps } from "@/server/appeals";
import { handle, json, readJson } from "@/server/http";
import { clock, m6db } from "@/server/m6-routes";
import { limitAppeal } from "@/server/ratelimit";
import { requireUser } from "@/server/session";
import { baseModerationConfig } from "@/server/moderation-config";

export const runtime = "nodejs";

const input = z.object({ caseId: z.string().min(1).max(64), statement: z.string().min(10).max(2000), asReporter: z.boolean().optional() }).strict();

/** Appellant is derived from the session only (AP-7); limiter `appeal.create` 3/day/user is enforced in the service (AP-3). */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = input.parse(await readJson(req));
    const deps: AppealDeps = { db: m6db, clock, config: await baseModerationConfig(), limit: async (key) => { await limitAppeal(key.split(":")[1] ?? user.id); return true; }, applyOverturn: async () => {} };
    return json(await fileAppeal(deps, { id: user.id }, body), 201);
  });
}
