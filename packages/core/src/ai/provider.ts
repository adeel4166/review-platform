import { z } from "zod";
import { CATEGORIES } from "../moderation/config";
import type { FailureCode, ScoreMap } from "../moderation/classify";

/** ADR-0028: scores-only contract. Strict: an extra key (e.g. an injected "verdict") is a schema failure (AIF-003, SEC-008). */
export const providerResponseSchema = z
  .object({
    scores: z.object(Object.fromEntries(CATEGORIES.map((c) => [c, z.number().min(0).max(1)]))).strict(),
    language: z.string().max(16).optional(),
    supportedLanguage: z.boolean().optional(),
    rationale: z.string().max(280).optional(),
  })
  .strict();

export type ProviderCall = (req: { system: string; user: string; timeoutMs: number }) => Promise<unknown>;
export class ProviderError extends Error {
  constructor(public failureCode: FailureCode, public retryAfterMs?: number) { super(`provider_error:${failureCode}`); }
}
export type ProviderResult =
  | { ok: true; scores: ScoreMap; rationale?: string; unsupportedLanguage: boolean }
  | { ok: false; failureCode: FailureCode; retryable: boolean; retryAfterMs?: number };

/** Parses a raw provider body (string or object). Never throws; anything unexpected is `schema`. */
export function parseProviderResponse(raw: unknown): ProviderResult {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try { v = JSON.parse(raw); } catch { return { ok: false, failureCode: "schema", retryable: false }; }
  }
  const r = providerResponseSchema.safeParse(v);
  if (!r.success) return { ok: false, failureCode: "schema", retryable: false };
  if (r.data.supportedLanguage === false) return { ok: false, failureCode: "unsupported_language", retryable: false };
  return { ok: true, scores: r.data.scores as ScoreMap, rationale: r.data.rationale, unsupportedLanguage: false };
}

/** Maps a thrown error to a failure code; retryable per the ADR-0028 table. */
export function mapProviderError(e: unknown): Extract<ProviderResult, { ok: false }> {
  if (e instanceof ProviderError) return { ok: false, failureCode: e.failureCode, retryable: e.failureCode === "timeout" || e.failureCode === "http_5xx" || e.failureCode === "http_429" || e.failureCode === "network", retryAfterMs: e.retryAfterMs };
  return { ok: false, failureCode: "network", retryable: true };
}

/** One attempt: call, then parse. */
export async function callProvider(call: ProviderCall, req: { system: string; user: string; timeoutMs: number }): Promise<ProviderResult> {
  try {
    return parseProviderResponse(await call(req));
  } catch (e) {
    return mapProviderError(e);
  }
}

/** Retry loop for the worker: backoff list per attempt, honouring Retry-After on 429. Returns the final result. */
export async function callWithRetries(call: ProviderCall, req: { system: string; user: string; timeoutMs: number }, opts: { maxAttempts: number; backoffMs: readonly number[]; sleep: (ms: number) => Promise<void> }): Promise<ProviderResult> {
  let last: ProviderResult = { ok: false, failureCode: "network", retryable: true };
  for (let i = 0; i < opts.maxAttempts; i++) {
    last = await callProvider(call, req);
    if (last.ok || !last.retryable) return last;
    if (i < opts.maxAttempts - 1) await opts.sleep(Math.max(opts.backoffMs[Math.min(i, opts.backoffMs.length - 1)] ?? 0, last.retryAfterMs ?? 0));
  }
  return last;
}
