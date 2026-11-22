import { validateModerationConfig, type ModerationConfig } from "@rp/core";
import { db } from "./db";

/** The ACTIVE ModerationConfig (spec §5.2). Fails closed: no ACTIVE row -> error, never a silent default. */
export async function baseModerationConfig(): Promise<ModerationConfig> {
  const row = await (db as unknown as { moderationConfig: { findFirst(a: unknown): Promise<{ config: unknown } | null> } }).moderationConfig.findFirst({ where: { status: "ACTIVE" } });
  if (!row) throw new Error("no ACTIVE moderation config");
  return validateModerationConfig(row.config);
}
