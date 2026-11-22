import { ProviderError, parseProviderResponse, type ProviderCall } from "./ai/provider";
import { CATEGORIES } from "./moderation/config";

/** Pluggable AI moderation provider. The API key is read from the environment only, never stored or logged. */
export interface ModerationInput {
  title: string;
  body: string;
  rating: number;
}

export interface ModerationAssessment {
  /** Probability the content violates policy, 0 (clean) .. 1 (clear violation). */
  score: number;
  /** How sure the provider is about `score`, 0..1. */
  confidence: number;
  reasons: string[];
}

export interface ModerationProvider {
  readonly name: string;
  assess(input: ModerationInput): Promise<ModerationAssessment>;
  /**
   * Scores-only call (ADR-0028) returning the raw provider body for ALL categories; the strict `parseProviderResponse` validates it.
   * Real providers implement this; the offline mock does not (the worker maps its legacy score instead).
   */
  readonly call?: ProviderCall;
}

/** HTTP transport seam: production uses `fetch`; tests inject a stub (no network, OPS-009 recorded run). */
export interface HttpRequest { url: string; headers: Record<string, string>; body: string; timeoutMs: number }
export interface HttpResponse { status: number; text: string; retryAfterSeconds?: number }
export type HttpTransport = (req: HttpRequest) => Promise<HttpResponse>;

export const fetchTransport: HttpTransport = async (req) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), req.timeoutMs);
  try {
    const r = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body, signal: ctl.signal });
    const ra = Number(r.headers.get("retry-after"));
    return { status: r.status, text: await r.text(), ...(Number.isFinite(ra) && ra > 0 ? { retryAfterSeconds: ra } : {}) };
  } catch {
    if (ctl.signal.aborted) throw new ProviderError("timeout");
    throw new ProviderError("network"); // message deliberately does not echo the cause (could contain request details)
  } finally {
    clearTimeout(timer);
  }
};

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const DEFAULT_MODERATION_MODEL = "claude-haiku-5-5";

/**
 * SEC-FIN-01: Anthropic Messages adapter. `system` is the pinned prompt; `user` is the JSON-delimited message whose `content` is data
 * (prompt-injection safe, SEC-008). The key goes only into the `x-api-key` header; no error, log or return value contains it.
 * Any transport error, non-2xx, or body that is not text -> ProviderError / garbage string -> `schema`, so the result is UNSURE (human queue), never CLEAN.
 */
export function anthropicProviderCall(apiKey: string, model: string, transport: HttpTransport = fetchTransport): ProviderCall {
  return async ({ system, user, timeoutMs }) => {
    const res = await transport({
      url: ANTHROPIC_URL,
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 600, temperature: 0, system, messages: [{ role: "user", content: user }] }),
      timeoutMs,
    });
    if (res.status === 429) throw new ProviderError("http_429", res.retryAfterSeconds ? res.retryAfterSeconds * 1000 : undefined);
    if (res.status >= 500) throw new ProviderError("http_5xx");
    if (res.status < 200 || res.status >= 300) throw new ProviderError("network"); // 4xx (auth, bad request): not retryable content-wise, fail to human
    let text = "";
    try {
      const body = JSON.parse(res.text) as { content?: { type?: string; text?: string }[] };
      text = (body.content ?? []).filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
    } catch { return ""; } // unparseable envelope -> schema failure
    const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
    return fenced ? fenced[1] : text;
  };
}

export const GEMINI_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
/** Google's rolling alias for the current Flash-Lite model (on the AI Studio free tier); override with MODERATION_MODEL. */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest";
const GEMINI_SAFETY_OFF = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]
  .map((category) => ({ category, threshold: "BLOCK_NONE" }));
/**
 * Gemini structured output: forces the exact category keys of `providerResponseSchema`. Without it Gemini invents its own category
 * names (harassment, hate_speech, ...) and every answer fails the strict parser (`schema` -> UNSURE -> human queue).
 */
export const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    scores: {
      type: "OBJECT",
      properties: Object.fromEntries(CATEGORIES.map((c) => [c, { type: "NUMBER", description: "Probability 0..1 that the content violates this policy category" }])),
      required: [...CATEGORIES],
      propertyOrdering: [...CATEGORIES],
    },
    language: { type: "STRING", description: "ISO 639-1 code of the content language, e.g. en" },
    supportedLanguage: { type: "BOOLEAN" },
    rationale: { type: "STRING", description: "One short sentence, at most 200 characters" },
  },
  required: ["scores"],
  propertyOrdering: ["scores", "language", "supportedLanguage", "rationale"],
} as const;

/** Clamps the two free-text fields to the parser's length limits; everything else is left for the strict parser to judge. */
function clampGeminiText(text: string): string {
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    if (!v || typeof v !== "object" || Array.isArray(v)) return text;
    if (typeof v.rationale === "string" && v.rationale.length > 280) v.rationale = v.rationale.slice(0, 280);
    if (typeof v.language === "string" && v.language.length > 16) delete v.language;
    return JSON.stringify(v);
  } catch { return text; }
}

/**
 * Google Gemini (AI Studio) adapter, same contract as the Anthropic one. The key goes only into the `x-goog-api-key` header, never the URL.
 * Gemini's own safety filters are relaxed so abusive reviews can be scored instead of blocked; a blocked/empty answer is still `schema` -> UNSURE.
 */
export function geminiProviderCall(apiKey: string, model: string, transport: HttpTransport = fetchTransport): ProviderCall {
  if (!/^[A-Za-z0-9._-]+$/.test(model)) throw new Error("MODERATION_MODEL has an invalid value for MODERATION_PROVIDER=gemini");
  return async ({ system, user, timeoutMs }) => {
    const res = await transport({
      url: `${GEMINI_URL_BASE}${model}:generateContent`,
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 2048, responseMimeType: "application/json", responseSchema: GEMINI_RESPONSE_SCHEMA },
        safetySettings: GEMINI_SAFETY_OFF,
      }),
      timeoutMs,
    });
    if (res.status === 429) throw new ProviderError("http_429", res.retryAfterSeconds ? res.retryAfterSeconds * 1000 : undefined);
    if (res.status >= 500) throw new ProviderError("http_5xx");
    if (res.status < 200 || res.status >= 300) throw new ProviderError("network");
    let text = "";
    try {
      const body = JSON.parse(res.text) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
      text = (body.candidates?.[0]?.content?.parts ?? []).filter((p) => typeof p?.text === "string" && !p.thought).map((p) => p.text).join("");
    } catch { return ""; }
    const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
    return clampGeminiText(fenced ? (fenced[1] ?? "") : text);
  };
}

/** Legacy single-score view of a scores-only result: the worst category, with high confidence only when every category was scored. */
const legacyAssess = (call: ProviderCall) => async ({ title, body, rating }: ModerationInput): Promise<ModerationAssessment> => {
  const r = parseProviderResponse(await call({ system: "", user: JSON.stringify({ task: "classify", contentType: "REVIEW", content: { title, body, rating } }), timeoutMs: 20_000 }));
  if (!r.ok) throw new ProviderError(r.failureCode);
  return { score: Math.max(...CATEGORIES.map((c) => r.scores[c])), confidence: 0.9, reasons: [] };
};

export interface ModerationThresholds {
  /** Below this confidence the result goes to a human regardless of score. */
  minConfidence: number;
  /** score <= cleanMax -> approve. */
  cleanMax: number;
  /** score >= violationMin -> reject. Between the two -> human. */
  violationMin: number;
}

export const DEFAULT_THRESHOLDS: ModerationThresholds = { minConfidence: 0.7, cleanMax: 0.2, violationMin: 0.8 };

export type AiVerdict = "APPROVED" | "REJECTED" | "NEEDS_HUMAN";

export function decideVerdict(a: ModerationAssessment, t: ModerationThresholds = DEFAULT_THRESHOLDS): AiVerdict {
  const valid = [a.score, a.confidence].every((n) => Number.isFinite(n) && n >= 0 && n <= 1);
  if (!valid) return "NEEDS_HUMAN"; // malformed provider output is "unsure", never approval
  if (a.confidence < t.minConfidence) return "NEEDS_HUMAN";
  if (a.score >= t.violationMin) return "REJECTED";
  if (a.score <= t.cleanMax) return "APPROVED";
  return "NEEDS_HUMAN";
}

const BLOCKLIST = ["scam", "fraud", "kill yourself", "viagra", "http://", "https://"];

/** Deterministic offline provider for dev/tests. Not a real classifier. */
export class MockModerationProvider implements ModerationProvider {
  readonly name = "mock";
  async assess({ title, body }: ModerationInput): Promise<ModerationAssessment> {
    const text = `${title} ${body}`.toLowerCase();
    const hits = BLOCKLIST.filter((w) => text.includes(w));
    if (text.includes("[[mock-fail]]")) throw new Error("mock provider failure");
    if (hits.length >= 2) return { score: 0.97, confidence: 0.95, reasons: hits.map((h) => `blocklist:${h}`) };
    if (hits.length === 1) return { score: 0.5, confidence: 0.9, reasons: [`blocklist:${hits[0]}`] };
    if (body.trim().length < 20) return { score: 0.1, confidence: 0.5, reasons: ["too_short_to_judge"] };
    return { score: 0.02, confidence: 0.9, reasons: [] };
  }
}

/**
 * Selects a provider by name. Real providers read their key from `env` (e.g. MODERATION_API_KEY) only.
 * SEC-M6-02: in production an unset provider or the offline `mock` is refused (the mock auto-approves anything without a blocklist word).
 */
export function createModerationProvider(env: { MODERATION_PROVIDER?: string; MODERATION_API_KEY?: string; MODERATION_MODEL?: string; NODE_ENV?: string }, transport?: HttpTransport): ModerationProvider {
  const production = env.NODE_ENV === "production";
  if (production && (!env.MODERATION_PROVIDER || env.MODERATION_PROVIDER === "mock")) {
    throw new Error("MODERATION_PROVIDER must be a real provider in production (mock/unset refused)");
  }
  const name = env.MODERATION_PROVIDER ?? "mock";
  if (name === "mock") return new MockModerationProvider();
  if (name === "anthropic") {
    if (!env.MODERATION_API_KEY) throw new Error("MODERATION_API_KEY is required for MODERATION_PROVIDER=anthropic"); // names only, never a value
    const call = anthropicProviderCall(env.MODERATION_API_KEY, env.MODERATION_MODEL || DEFAULT_MODERATION_MODEL, transport);
    return { name, call, assess: legacyAssess(call) };
  }
  if (name === "gemini") {
    if (!env.MODERATION_API_KEY) throw new Error("MODERATION_API_KEY is required for MODERATION_PROVIDER=gemini"); // names only, never a value
    const call = geminiProviderCall(env.MODERATION_API_KEY, env.MODERATION_MODEL || DEFAULT_GEMINI_MODEL, transport);
    return { name, call, assess: legacyAssess(call) };
  }
  // Unknown provider: fail loudly rather than silently approving.
  throw new Error(`Unsupported MODERATION_PROVIDER "${name}"`);
}

/**
 * M8-02 startup check (fail closed): called at worker boot so a production process with MODERATION_PROVIDER unset, `mock` or
 * unsupported never starts, instead of failing on the first moderation job. Returns the provider name; throws with names only.
 */
export function assertModerationProviderConfigured(env: { MODERATION_PROVIDER?: string; MODERATION_API_KEY?: string; MODERATION_MODEL?: string; NODE_ENV?: string }): string {
  return createModerationProvider(env).name;
}
