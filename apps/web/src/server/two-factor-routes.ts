import { verifyPassword } from "@rp/db";
import { z } from "zod";
import { rotateCookie } from "./auth";
import { db } from "./db";
import { json, readJson, HttpError } from "./http";
import { requirePendingSession } from "./pending-session";
import { limit2fa } from "./ratelimit";
import { requireTwoFactor, requireUser } from "./session";
import { confirmEnrolment, disableTwoFactor, envDeps, regenerateRecoveryCodes, startEnrolment, stepUp, twoFactorStatus, verifySecondFactor, type TfDb } from "./two-factor";

const tf = db as unknown as TfDb;
const deps = (req: Request) => envDeps((kind, userId) => limit2fa(req, kind, userId));
const codeBody = z.object({ code: z.string().min(6).max(32) });

/** Shared by the two pending-only endpoints. */
export async function verifyRoute(req: Request, kind: "TOTP" | "RECOVERY_CODE") {
  const raw = await readJson(req); // Origin and content-type checks
  const p = await requirePendingSession(req); // deny before validating the payload
  const body = codeBody.parse(raw);
  const r = await verifySecondFactor(tf, deps(req), { sid: p.sid, userId: p.userId, code: body.code, kind });
  await rotateCookie();
  return json({ status: "verified", method: r.method }, 200, { "Cache-Control": "no-store" });
}

export async function stepUpRoute(req: Request) {
  const a = await requireUser();
  const body = z.object({ password: z.string().min(1).max(256), code: z.string().max(32).optional() }).parse(await readJson(req));
  if (!a.sid) throw new HttpError(401, "unauthenticated", "Sign in required");
  return json(await stepUp(tf, deps(req), { sid: a.sid, userId: a.id, ...body, verifyPassword }));
}

export async function statusRoute() {
  const a = await requireUser();
  return json(await twoFactorStatus(tf, a.id), 200, { "Cache-Control": "no-store" });
}

export async function enrolRoute(req: Request) {
  const body = z.object({ currentCode: z.string().max(32).optional() }).parse(await readJson(req).catch(() => ({})));
  const a = await requireUser();
  return json(await startEnrolment(tf, deps(req), { userId: a.id, stepUpAt: a.stepUpAt ?? null, currentCode: body.currentCode }), 200, { "Cache-Control": "no-store" });
}

export async function confirmRoute(req: Request) {
  const a = await requireUser();
  const body = codeBody.parse(await readJson(req));
  if (!a.sid) throw new HttpError(401, "unauthenticated", "Sign in required");
  const r = await confirmEnrolment(tf, deps(req), { userId: a.id, sid: a.sid, code: body.code });
  await rotateCookie();
  return json({ status: "enabled", recoveryCodes: r.recoveryCodes ?? null }, 200, { "Cache-Control": "no-store" });
}

export async function regenerateRoute(req: Request) {
  await readJson(req).catch(() => undefined);
  const a = requireTwoFactor(await requireUser());
  return json(await regenerateRecoveryCodes(tf, deps(req), { userId: a.id, stepUpAt: a.stepUpAt ?? null }), 200, { "Cache-Control": "no-store" });
}

export async function disableRoute(req: Request) {
  await readJson(req).catch(() => undefined);
  const a = requireTwoFactor(await requireUser());
  if (!a.sid) throw new HttpError(401, "unauthenticated", "Sign in required");
  return json(await disableTwoFactor(tf, deps(req), { userId: a.id, sid: a.sid, stepUpAt: a.stepUpAt ?? null }));
}
