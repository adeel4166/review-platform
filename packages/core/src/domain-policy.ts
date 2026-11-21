/**
 * Claim domain policy (M3 spec §5.2, SEL-002, O-2/O-3). Pure, no I/O.
 *
 * A claimable domain must equal its registrable domain under an ICANN public suffix. Names under private suffixes
 * (github.io, myshopify.com, wixsite.com, ...) and shared-host / free-mail domains are refused.
 *
 * NOTE: the suffix tables below are a pinned, deliberately small subset of the Public Suffix List (multi-label ICANN
 * suffixes + the common PRIVATE section). Any single-label TLD is treated as ICANN. Swapping in a full `tldts` PSL snapshot
 * (M3-Q7) only has to replace `icannSuffixLength` / `isPrivateSuffix`; the policy and tests stay the same.
 */
import { domainToASCII } from "node:url";

export type DomainDenyReason = "invalid" | "ip_literal" | "not_registrable" | "shared_host" | "free_mail" | "no_mx";

export class DomainNotAllowedError extends Error {
  constructor(public reason: DomainDenyReason) {
    super(`domain_not_allowed:${reason}`);
    this.name = "DomainNotAllowedError";
  }
}

/** Multi-label ICANN suffixes (registrable domain = suffix + one label). */
const ICANN_MULTI = new Set([
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "ac.uk", "gov.uk", "net.uk", "sch.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "co.nz", "net.nz", "org.nz", "co.za", "org.za",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "co.kr", "or.kr", "co.in", "net.in", "org.in", "firm.in", "gen.in", "ind.in",
  "com.br", "net.br", "org.br", "com.mx", "org.mx", "com.ar", "com.co", "com.pe", "com.ve", "com.tr", "org.tr", "net.tr",
  "com.cn", "net.cn", "org.cn", "com.hk", "org.hk", "com.tw", "org.tw", "com.sg", "com.my", "com.ph", "com.vn", "co.id", "co.th",
  "com.sa", "com.eg", "co.il", "org.il", "com.ua", "com.pl", "com.pt", "com.es", "com.ru", "co.ke", "co.ug", "com.ng", "com.gh", "com.pk", "com.bd", "com.lk",
]);

/** Private-section suffixes: a claim under these proves control of a page, not of a brand. */
const PRIVATE_SUFFIXES = new Set([
  "github.io", "githubusercontent.com", "gitlab.io", "myshopify.com", "wixsite.com", "wixstudio.io", "netlify.app", "vercel.app", "now.sh",
  "pages.dev", "workers.dev", "blogspot.com", "blogspot.co.uk", "herokuapp.com", "azurewebsites.net", "cloudfront.net", "appspot.com",
  "web.app", "firebaseapp.com", "onrender.com", "fly.dev", "glitch.me", "repl.co", "replit.app", "weebly.com", "wordpress.com", "tumblr.com",
  "squarespace.com", "webflow.io", "carrd.co", "mystrikingly.com", "godaddysites.com", "myportfolio.com", "notion.site", "framer.app",
  "s3.amazonaws.com", "elasticbeanstalk.com", "ngrok.io", "ngrok-free.app", "trycloudflare.com", "bubbleapps.io", "base44.app", "lovable.app",
]);

/** Hosting / site-builder registrable domains that are not in the PSL private section (denylist/shared-hosts). */
const SHARED_HOSTS = new Set([
  "shopify.com", "myshopify.com", "wix.com", "wixsite.com", "squarespace.com", "weebly.com", "wordpress.com", "godaddy.com", "bigcommerce.com",
  "etsy.com", "ebay.com", "amazon.com", "aliexpress.com", "alibaba.com", "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com",
  "tiktok.com", "youtube.com", "google.com", "sites.google.com", "medium.com", "substack.com", "linktr.ee", "carrd.co", "000webhostapp.com",
  "infinityfree.net", "byethost.com", "freewebhostingarea.com", "live.net", "webnode.com", "jimdo.com", "jimdofree.com", "ucoz.com", "strikingly.com",
  "bravenet.com", "tripod.com", "angelfire.com", "geocities.com", "wordpress.org", "github.com", "gitlab.com", "bitbucket.org", "netlify.com", "vercel.com",
]);

/** Free-mail registrable domains (exact) and registrable labels that apply under any suffix (yahoo.*, hotmail.*, ...). */
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "pm.me",
  "aol.com", "mail.ru", "inbox.ru", "bk.ru", "list.ru", "qq.com", "163.com", "126.com", "sina.com", "zoho.com", "zohomail.com", "fastmail.com",
  "tutanota.com", "tuta.io", "hey.com", "mail.com", "email.com", "usa.com", "rocketmail.com", "yandex.com", "yandex.ru", "rambler.ru", "web.de", "t-online.de",
  "orange.fr", "free.fr", "libero.it", "naver.com", "daum.net", "hanmail.net", "cox.net", "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "mailinator.com",
  "guerrillamail.com", "10minutemail.com", "tempmail.com", "yopmail.com", "gmx.com", "gmx.net", "gmx.de",
]);
const FREE_MAIL_LABELS = new Set(["hotmail", "yahoo", "gmx", "yandex", "outlook", "live", "ymail"]);

/** TLDs that are never public-DNS names (internal, reserved or special-use). */
const SPECIAL_TLDS = new Set(["local", "localhost", "internal", "intranet", "corp", "home", "lan", "localdomain", "test", "example", "invalid", "onion", "arpa", "private", "kubernetes", "svc", "cluster", "domain", "lab", "router", "box"]);

export interface NormalizedDomain { domain: string; labels: string[]; suffix: string; registrable: string }

function isIpLiteral(s: string): boolean {
  if (s.includes(":") || s.startsWith("[")) return true;
  const last = s.split(".").pop() ?? "";
  return /^(0x[0-9a-f]*|\d+)$/i.test(last); // WHATWG treats a numeric/hex last label as an IPv4 literal (decimal, octal, hex)
}

/** §5.2 step 1: lowercase, strip one trailing dot, IDN -> A-label, structural checks. Does not apply the suffix policy. */
export function normalizeHostname(input: string): string {
  let s = input.trim().toLowerCase();
  if (s.endsWith(".")) s = s.slice(0, -1);
  if (!s) throw new DomainNotAllowedError("invalid");
  if (/[\s/\\@?#%]/.test(s)) throw new DomainNotAllowedError("invalid");
  if (isIpLiteral(s)) throw new DomainNotAllowedError("ip_literal");
  const ascii = domainToASCII(s);
  if (!ascii || ascii.length > 253) throw new DomainNotAllowedError("invalid");
  const labels = ascii.split(".");
  if (labels.length < 2 || labels.some((l) => l.length === 0 || l.length > 63 || !/^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?$/.test(l))) throw new DomainNotAllowedError("invalid");
  if (isIpLiteral(ascii)) throw new DomainNotAllowedError("ip_literal");
  const tld = labels[labels.length - 1]!;
  if (!/^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld) || SPECIAL_TLDS.has(tld)) throw new DomainNotAllowedError("not_registrable");
  return ascii;
}

const suffixOf = (labels: string[], n: number) => labels.slice(-n).join(".");

/** Length (in labels) of the public suffix, and whether it is in the PRIVATE section. */
function classify(labels: string[]): { suffixLen: number; isPrivate: boolean } {
  for (let n = Math.min(3, labels.length); n >= 2; n--) {
    const suf = suffixOf(labels, n);
    if (PRIVATE_SUFFIXES.has(suf)) return { suffixLen: n, isPrivate: true };
  }
  for (let n = Math.min(2, labels.length); n >= 2; n--) {
    if (ICANN_MULTI.has(suffixOf(labels, n))) return { suffixLen: n, isPrivate: false };
  }
  return { suffixLen: 1, isPrivate: false };
}

/**
 * assertOwnableDomain (§5.2). Returns the A-label domain, or throws DomainNotAllowedError with a sub-reason.
 * `purpose: "email"` additionally applies the free-mail deny-list. The MX requirement is `assertHasMx`.
 */
export function assertOwnableDomain(input: string, purpose: "claim" | "email" = "claim"): NormalizedDomain {
  const domain = normalizeHostname(input);
  const labels = domain.split(".");
  const { suffixLen, isPrivate } = classify(labels);
  if (isPrivate) throw new DomainNotAllowedError("shared_host");
  if (labels.length !== suffixLen + 1) throw new DomainNotAllowedError("not_registrable"); // a bare suffix or a subdomain
  const suffix = suffixOf(labels, suffixLen);
  if (SHARED_HOSTS.has(domain) || [...SHARED_HOSTS].some((h) => domain.endsWith(`.${h}`))) throw new DomainNotAllowedError("shared_host");
  if (purpose === "email" && (FREE_MAIL.has(domain) || FREE_MAIL_LABELS.has(labels[0]!))) throw new DomainNotAllowedError("free_mail");
  return { domain, labels, suffix, registrable: domain };
}

/** Domain part of a business e-mail, which must equal (or sit under) the claimed domain. */
export function businessEmailDomain(email: string, claimedDomain: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1 || email.indexOf("@") !== at) throw new DomainNotAllowedError("invalid");
  const d = assertOwnableDomain(email.slice(at + 1), "email").domain;
  if (d !== claimedDomain && !d.endsWith(`.${claimedDomain}`)) throw new DomainNotAllowedError("invalid");
  return d;
}

/** §5.2 step 4: at least one MX record, looked up through the injected (egress) resolver. */
export async function assertHasMx(domain: string, lookupMx: (d: string) => Promise<readonly unknown[]>): Promise<void> {
  let records: readonly unknown[] = [];
  try {
    records = await lookupMx(domain);
  } catch {
    records = [];
  }
  if (records.length === 0) throw new DomainNotAllowedError("no_mx");
}
