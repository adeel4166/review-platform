import type { RuleHit } from "./classify";

export interface RuleSet { blocklist: readonly string[]; badUrlHosts: readonly string[]; bannedMediaSha256: ReadonlySet<string>; knownTextHashes: ReadonlySet<string> }
/** Deterministic rules (pipeline §2.2 step 1). A malware attachment is NOT a violation rule: classify() forces UNSURE instead. */
export function evaluateRules(rs: RuleSet, i: { text: string; textHash?: string; mediaSha256?: readonly string[] }): RuleHit[] {
  const hits: RuleHit[] = [];
  const lower = i.text.toLowerCase();
  for (const w of rs.blocklist) if (lower.includes(w.toLowerCase())) hits.push({ id: `blocklist:${w}`, violation: true });
  for (const m of lower.matchAll(/https?:\/\/([^\s/]+)/g)) if (rs.badUrlHosts.includes(m[1]!)) hits.push({ id: `bad_url:${m[1]}`, violation: true });
  if (i.textHash && rs.knownTextHashes.has(i.textHash)) hits.push({ id: "duplicate_text", violation: true });
  for (const h of i.mediaSha256 ?? []) if (rs.bannedMediaSha256.has(h)) hits.push({ id: "banned_media", violation: true });
  return hits;
}
