import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateModerationConfig, type ModerationConfig } from "./config";

/** The example config from the architecture docs, validated (test helper). */
export function baseConfigRaw(): Record<string, unknown> {
  const p = fileURLToPath(new URL("../../../../docs/architecture/moderation-config.example.json", import.meta.url));
  const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  delete raw.$comment;
  return raw;
}
export const baseConfig = (): ModerationConfig => validateModerationConfig(baseConfigRaw());
