/**
 * Seller reply content policy (m3b-spec §5.2, ADR-0021). Pure: no I/O.
 * Hard violations are rejected synchronously with their reason names (deterministic rules, safe to disclose).
 * Soft flags never block but force the moderation case to NEEDS_HUMAN. The body is plain text only.
 */
import { PSL_ICANN_RULES } from "./psl-snapshot";

export const REPLY_MAX_CHARS = 1500;
export const REPLY_MAX_LINE_BREAKS = 15;
/** The seller's first N replies always go to a human (m3b-spec §5.3). */
export const REPLY_NEW_SELLER_HUMAN_COUNT = 5;

/** Rate limits (m3b-spec §5.6). */
export const REPLY_LIMITS = { userPerHour: 20, userPerDay: 100, sellerPerDay: 300, editsPerReplyPerDay: 5 } as const;

export type ReplyHardReason = "link" | "email" | "markup" | "invisible" | "too_long" | "empty";
export type ReplySoftFlag = "phone" | "contact_channel" | "spelled_out_link" | "spelled_out_email";

export interface ReplyPolicyResult {
  /** NFC-normalized, blank-line-collapsed body that should be stored. */
  body: string;
  hard: ReplyHardReason[];
  soft: ReplySoftFlag[];
}

const ICANN_TLDS: ReadonlySet<string> = new Set(PSL_ICANN_RULES.split("\n").filter((r) => r && !r.includes(".") && !r.startsWith("!") && !r.startsWith("*")));

// Bidi controls, zero-width, word joiner, BOM, tag characters, and C0/C1 controls other than \n (and \r, normalized away first).
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u202A-\u202E\u2066-\u2069\u200B-\u200F\u2060\uFEFF\u{E0000}-\u{E007F}\u0000-\u0009\u000B-\u001F\u007F-\u009F]/u;
const MARKUP = /<[a-z!/?]|\]\s*\(|!\[|&#\d+;?|&#x[0-9a-f]+;?|&[a-z][a-z0-9]{1,31};/i;
const SCHEME = /(?:^|[^a-z0-9+.-])(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|tel:|javascript:|data:|vbscript:|file:)/i;
const WWW = /(?:^|[^a-z0-9])www\./i;
const EMAIL = /[^\s@<>()[\],;:"]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;
const SPELLED_LINK = /\b[a-z0-9-]{2,}\s*(?:\(\s*dot\s*\)|\[\s*dot\s*\]|\bdot\b)\s*(?:com|net|org|io|co|shop|store|info|biz|me|app|xyz)\b/i;
const SPELLED_AT = /\s*(?:\(\s*at\s*\)|\[\s*at\s*\]|\{\s*at\s*\})\s*/i;
const CONTACT_WORDS =
  /\b(?:whats\s?app|telegram|t\.me|wa\.me|wechat|we\s?chat|signal|viber|skype|line\s?id|dm\s+us|text\s+us|call\s+us|email\s+us|e-mail\s+us|message\s+us\s+on|contact\s+us\s+(?:at|on|via))\b/i;
// 7+ digits across optional separators, optionally with a leading +. Soft because order numbers look alike.
const PHONE = /(?:\+\s*\d[\d\s().-]{6,}\d)|(?:\(?\d{2,4}\)?[\s.-]\d{2,4}[\s.-]\d{2,5}(?:[\s.-]\d{1,5})?)|(?:\b\d{9,}\b)/;

/** Maps fullwidth/ideographic dots, `[.]` and `(.)` to `.` before link detection (obfuscation). */
function foldDots(s: string): string {
  return s.replace(/[．。｡]/g, ".").replace(/\s*[[(]\s*\.\s*[\])]\s*/g, ".").replace(/＠/g, "@");
}

function hasBareDomain(s: string): boolean {
  const re = /(?:^|[^a-z0-9@-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59}))(?![a-z0-9-])/gi;
  for (const m of s.matchAll(re)) {
    const tld = m[2]!.toLowerCase();
    if (!ICANN_TLDS.has(tld)) continue;
    // "e.g." / "i.e." style abbreviations and sentence-ends without a space ("end.Next") are not hosts: require the label before the dot to be 2+ chars
    // unless it is a single-label domain; and the char after the dot must not be an uppercase continuation of a sentence ("word.The").
    return true;
  }
  return false;
}

export function checkReplyPolicy(raw: string): ReplyPolicyResult {
  const body = raw.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const hard = new Set<ReplyHardReason>();
  const soft = new Set<ReplySoftFlag>();

  if (body.length === 0) hard.add("empty");
  if ([...body].length > REPLY_MAX_CHARS || (body.match(/\n/g)?.length ?? 0) > REPLY_MAX_LINE_BREAKS) hard.add("too_long");
  if (INVISIBLE.test(body)) hard.add("invisible");
  if (MARKUP.test(body)) hard.add("markup");

  const folded = foldDots(body);
  if (SCHEME.test(folded) || WWW.test(folded) || hasBareDomain(folded)) hard.add("link");
  if (EMAIL.test(folded)) hard.add("email");

  if (SPELLED_LINK.test(folded)) soft.add("spelled_out_link");
  if (SPELLED_AT.test(folded) && /[a-z0-9._-]+\s*(?:\(\s*at\s*\)|\[\s*at\s*\]|\{\s*at\s*\})\s*[a-z0-9-]+/i.test(folded)) soft.add("spelled_out_email");
  if (CONTACT_WORDS.test(folded)) soft.add("contact_channel");
  if (PHONE.test(folded)) soft.add("phone");

  return { body, hard: [...hard], soft: [...soft] };
}

/** True when the reply must go to a human regardless of the AI verdict (soft flags or a new seller). */
export const replyForcesHuman = (soft: readonly ReplySoftFlag[], priorReplyCount: number): boolean =>
  soft.length > 0 || priorReplyCount < REPLY_NEW_SELLER_HUMAN_COUNT;
