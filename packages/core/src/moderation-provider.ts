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
}

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
export function createModerationProvider(env: { MODERATION_PROVIDER?: string; MODERATION_API_KEY?: string; NODE_ENV?: string }): ModerationProvider {
  const production = env.NODE_ENV === "production";
  if (production && (!env.MODERATION_PROVIDER || env.MODERATION_PROVIDER === "mock")) {
    throw new Error("MODERATION_PROVIDER must be a real provider in production (mock/unset refused)");
  }
  const name = env.MODERATION_PROVIDER ?? "mock";
  if (name === "mock") return new MockModerationProvider();
  // No real provider is wired yet; fail loudly rather than silently approving.
  throw new Error(`Unsupported MODERATION_PROVIDER "${name}"`);
}
