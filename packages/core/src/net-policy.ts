/**
 * Address policy for the SSRF-safe fetcher (M3 spec §6.3, SEC-007). Everything that is not explicitly public unicast is
 * denied. No dependencies: IPv4/IPv6 are parsed here so the policy is deterministic and testable.
 */
import { isIP } from "node:net";

type Cidr4 = readonly [string, number];

const DENY_V4: readonly Cidr4[] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4], ["255.255.255.255", 32],
];

/** [address, prefix length]. IPv4-mapped and NAT64 (/96) are unwrapped before this table is consulted. */
const DENY_V6: ReadonlyArray<readonly [string, number]> = [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32], ["2001:2::", 48],
  ["2001:10::", 28], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
];

export function parseIPv4(s: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const o = Number(m[i]);
    if (o > 255) return null;
    n = n * 256 + o;
  }
  return n;
}

/** Expands any valid IPv6 text form (including `::` and an embedded dotted IPv4 tail) to a 128-bit BigInt. */
export function parseIPv6(input: string): bigint | null {
  let s = input.toLowerCase();
  const pct = s.indexOf("%");
  if (pct >= 0) s = s.slice(0, pct); // zone id
  if (isIP(s) !== 6) return null;
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (v4 === null) return null;
    s = `${s.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const [head, rest, extra] = s.split("::");
  if (extra !== undefined) return null;
  const h = head ? head.split(":") : [];
  const t = rest !== undefined && rest ? rest.split(":") : [];
  const missing = 8 - h.length - t.length;
  if (rest === undefined ? h.length !== 8 : missing < 1) return null;
  const groups = rest === undefined ? h : [...h, ...Array<string>(missing).fill("0"), ...t];
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

const inV4 = (ip: number, [base, bits]: Cidr4) => {
  const b = parseIPv4(base)!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((b & mask) >>> 0);
};
const inV6 = (ip: bigint, [base, bits]: readonly [string, number]) => {
  const b = parseIPv6(base)!;
  const shift = BigInt(128 - bits);
  return ip >> shift === b >> shift;
};

function isPublicV4(n: number): boolean {
  return !DENY_V4.some((c) => inV4(n, c));
}

/** True only for public unicast addresses. Garbage, IP literals in odd notations and every reserved range are false. */
export function isPublicAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const n = parseIPv4(address);
    return n !== null && isPublicV4(n);
  }
  if (v === 6) {
    const n = parseIPv6(address);
    if (n === null) return false;
    const low32 = Number(n & 0xffffffffn);
    if (n >> 32n === 0xffffn) return isPublicV4(low32); // ::ffff:a.b.c.d
    if (n >> 32n === 0x64ff9bn << 64n) return isPublicV4(low32); // 64:ff9b::/96
    if (DENY_V6.some((c) => inV6(n, c))) return false;
    return n >> 125n === 1n; // 2000::/3 global unicast only
  }
  return false;
}
