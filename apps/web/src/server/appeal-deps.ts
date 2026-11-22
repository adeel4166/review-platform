import { type AppealDeps } from "./appeals";
import { clock, m6db } from "./m6-routes";
import { baseModerationConfig } from "./moderation-config";
import { restoreContent } from "./m6-ui";

/** Shared construction of AppealDeps for the appeal routes (limiter is applied by the filing route only). */
export async function appealDeps(): Promise<AppealDeps> {
  return { db: m6db, clock, config: await baseModerationConfig(), limit: async () => true, applyOverturn: (tx, a, reviewerId) => restoreContent(tx, a, reviewerId, clock.now()) };
}
