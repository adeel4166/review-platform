/** OPS-004 / PRV-001: log scrubber and error-tracker `beforeSend`. Redacts PII-shaped values and keys; used by the logger and the Sentry-style hook. */
export const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /^(e-?mail|ip|ip_?addr(ess)?|client_?ip|x_?forwarded_?for|user_?agent|password(_?hash)?|secret\w*|token\w*|authorization|cookie|set-cookie|api_?key|phone|merchant_?name|order_?ref\w*)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6 = /\b(?:[0-9a-fA-F]{1,4}:){4,7}[0-9a-fA-F]{1,4}\b/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g;

export const scrubString = (s: string): string => s.replace(EMAIL, REDACTED).replace(BEARER, `$1 ${REDACTED}`).replace(IPV4, REDACTED).replace(IPV6, REDACTED);

export function scrub(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubString(value);
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (value instanceof Error) return { name: value.name, message: scrubString(value.message), stack: value.stack ? scrubString(value.stack) : undefined };
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? REDACTED : scrub(v, depth + 1)]));
}

/** Error-tracker hook (Sentry `beforeSend` shape): scrubs the whole event, drops request bodies, cookies and user ip. */
export function beforeSend<T extends Record<string, unknown>>(event: T): T {
  const e = scrub(event) as Record<string, unknown>;
  if (e.request && typeof e.request === "object") { const r = e.request as Record<string, unknown>; delete r.data; delete r.cookies; }
  if (e.user && typeof e.user === "object") e.user = { id: (e.user as Record<string, unknown>).id };
  return e as T;
}

export type LogSink = (line: string) => void;
/** JSON logger that always scrubs when `scrubOn` (forced on in production by the env schema). */
export function createLogger(scrubOn: boolean, sink: LogSink = (l) => console.log(l)) {
  return (obj: Record<string, unknown>) => sink(JSON.stringify(scrubOn ? scrub(obj) : obj));
}
