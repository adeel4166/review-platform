"use client";

import { t } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { field } from "../seller/ui";

/** Re-authentication (wireframe 1.5): POST /api/auth/step-up. Throws ApiError("invalid_credentials"-style) on a bad password/code. */
export async function stepUp(password: string, code?: string): Promise<void> {
  try {
    await api("/api/auth/step-up", { method: "POST", body: JSON.stringify({ password, ...(code ? { code } : {}) }) });
  } catch (e) {
    throw e instanceof ApiError ? e : new ApiError(500, "error");
  }
}

/** Password (+ optional authenticator code) inputs for a step-up. Uncontrolled: read by name from the surrounding form. */
export function StepUpFields({ idPrefix, withCode }: { idPrefix: string; withCode?: boolean }) {
  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-pw`} className="font-medium">{t("tf.password")}</label>
        <input id={`${idPrefix}-pw`} name="stepUpPassword" type="password" autoComplete="current-password" required className={field} />
      </div>
      {withCode && (
        <div>
          <label htmlFor={`${idPrefix}-code`} className="font-medium">{t("tf.code")}</label>
          <input id={`${idPrefix}-code`} name="stepUpCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className={field} />
        </div>
      )}
    </>
  );
}
