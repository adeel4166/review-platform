/**
 * SSRF-safe website fetcher (ADR-0015, M3 spec §6, SEC-007). WORKER ONLY: apps/web must never import this.
 *
 * Per hop: validate URL (scheme, no userinfo, port 80/443 matching the scheme, DNS-name host) -> resolve A+AAAA, EVERY
 * answer must be public unicast -> pin one IP -> connect to the pinned IP only (never re-resolve) and assert the remote
 * address. At most 3 redirects, each fully re-validated. 5 s total, 1 MB body, GET only, fixed headers, no cookies.
 */
import http from "node:http";
import https from "node:https";
import { Resolver } from "node:dns/promises";
import { DomainNotAllowedError, isPublicAddress, normalizeHostname } from "@rp/core";

export type FetchError =
  | "BLOCKED_SCHEME" | "BLOCKED_URL" | "BLOCKED_PORT" | "BLOCKED_HOST" | "BLOCKED_IP" | "DNS_FAILURE" | "TOO_MANY_REDIRECTS"
  | "REDIRECT_OFF_DOMAIN" | "TIMEOUT" | "BODY_TOO_LARGE" | "BAD_STATUS" | "BAD_CONTENT_TYPE" | "FETCH_ERROR";

export type FetchResult =
  | { ok: true; finalUrl: string; status: 200; body: Buffer; hops: number; pinnedIps: string[] }
  | { ok: false; error: FetchError; hop: number; detail?: string }; // detail never contains the body

export const FETCH_LIMITS = { totalMs: 5000, connectMs: 2000, maxBytes: 1_048_576, maxRedirects: 3 } as const;

export interface ResolverLike { resolve(host: string): Promise<string[]> }

export interface TransportRequest { url: URL; ip: string; port: number; signal: AbortSignal; headers: Record<string, string>; connectMs: number }
export interface TransportResponse { status: number; headers: Record<string, string | undefined>; remoteAddress?: string; body: AsyncIterable<Uint8Array>; destroy(): void }
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

export interface SafeFetcherOptions {
  resolver: ResolverLike;
  /** Defaults to a real node:http(s) transport that connects to the pinned IP. Tests inject a fake. */
  transport?: Transport;
  userAgent?: string;
  /**
   * TEST ONLY: CIDR-less exact-IP allowlist for loopback servers in response-limit tests. Passed only to the constructor;
   * the production factory never sets it and no environment variable can (asserted in tests).
   */
  unsafeTestAllowlist?: readonly string[];
  limits?: { totalMs?: number; connectMs?: number; maxBytes?: number; maxRedirects?: number };
}

export interface FetchOptions {
  /** META_TAG: the FINAL url must be https and inside this domain (host === domain or a subdomain). */
  finalMustBeInside?: string;
}

/** Public resolvers only (never the cluster DNS). VERIFY_DNS_SERVERS overrides, default 1.1.1.1,8.8.8.8. */
export function createDnsResolver(servers = (process.env.VERIFY_DNS_SERVERS ?? "1.1.1.1,8.8.8.8").split(",").map((s) => s.trim()).filter(Boolean)): ResolverLike & {
  resolveTxt(host: string): Promise<string[][]>;
  resolveMx(host: string): Promise<Array<{ exchange: string; priority: number }>>;
} {
  const r = new Resolver({ timeout: 2000, tries: 1 });
  r.setServers(servers);
  return {
    async resolve(host) {
      const [a, aaaa] = await Promise.allSettled([r.resolve4(host), r.resolve6(host)]);
      return [...(a.status === "fulfilled" ? a.value : []), ...(aaaa.status === "fulfilled" ? aaaa.value : [])];
    },
    resolveTxt: (h) => r.resolveTxt(h),
    resolveMx: (h) => r.resolveMx(h),
  };
}

/** Real transport: connects to the pinned IP via a custom `lookup`; TLS SNI/cert use the hostname. No proxy, no cookies. */
export const nodeTransport: Transport = (req) =>
  new Promise((resolve, reject) => {
    const isTls = req.url.protocol === "https:";
    const mod = isTls ? https : http;
    const family = req.ip.includes(":") ? 6 : 4;
    const r = mod.request(
      {
        host: req.url.hostname, port: req.port, path: `${req.url.pathname}${req.url.search}`, method: "GET", headers: req.headers, agent: false, signal: req.signal,
        servername: isTls ? req.url.hostname : undefined, minVersion: isTls ? "TLSv1.2" : undefined, rejectUnauthorized: true,
        // The name is never resolved again: only the pinned address is ever returned (anti DNS-rebinding).
        lookup: (_h: string, _o: unknown, cb: (...a: unknown[]) => void) => (_o as { all?: boolean })?.all ? cb(null, [{ address: req.ip, family }]) : cb(null, req.ip, family),
      } as http.RequestOptions,
      (res) => {
        const headers: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
        resolve({ status: res.statusCode ?? 0, headers, remoteAddress: res.socket.remoteAddress, body: res, destroy: () => res.destroy() });
      },
    );
    r.setTimeout(req.connectMs, () => r.destroy(new Error("connect timeout")));
    r.on("error", reject);
    r.end();
  });

const inside = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function createSafeFetcher(opts: SafeFetcherOptions) {
  const lim = { ...FETCH_LIMITS, ...opts.limits };
  const transport = opts.transport ?? nodeTransport;
  const allow = new Set(opts.unsafeTestAllowlist ?? []);
  const ua = opts.userAgent ?? `ReviewPlatformVerifier/1 (+${process.env.APP_URL ?? "https://localhost"}/verifier)`;
  const addrOk = (ip: string) => isPublicAddress(ip) || allow.has(ip);

  async function fetchOnce(startUrl: string, fo: FetchOptions = {}): Promise<FetchResult> {
    const signal = AbortSignal.timeout(lim.totalMs); // one budget over DNS, connect, TLS, hops and body
    const aborted = new Promise<never>((_, rej) => signal.addEventListener("abort", () => rej(new Error("TIMEOUT")), { once: true }));
    aborted.catch(() => undefined);
    const fail = (error: FetchError, hop: number, detail?: string): FetchResult => ({ ok: false, error, hop, detail });
    const pinnedIps: string[] = [];
    let current: URL;
    try {
      current = new URL(startUrl);
    } catch {
      return fail("BLOCKED_URL", 0);
    }
    for (let hop = 0; hop <= lim.maxRedirects; hop++) {
      // --- validateUrl
      if (current.protocol !== "http:" && current.protocol !== "https:") return fail("BLOCKED_SCHEME", hop);
      if (current.username || current.password) return fail("BLOCKED_URL", hop);
      const defaultPort = current.protocol === "https:" ? "443" : "80";
      if (current.port !== "" && current.port !== defaultPort) return fail("BLOCKED_PORT", hop);
      const port = Number(defaultPort);
      let host: string;
      try {
        host = normalizeHostname(current.hostname); // IP literals (any notation), single-label and special-use names are refused
      } catch (e) {
        return fail("BLOCKED_HOST", hop, e instanceof DomainNotAllowedError ? e.reason : undefined);
      }
      // --- resolveAndPin
      let answers: string[];
      try {
        answers = await Promise.race([opts.resolver.resolve(host), aborted]);
      } catch (e) {
        return fail((e as Error).message === "TIMEOUT" ? "TIMEOUT" : "DNS_FAILURE", hop);
      }
      if (answers.length === 0) return fail("DNS_FAILURE", hop);
      if (!answers.every(addrOk)) return fail("BLOCKED_IP", hop); // one private answer blocks the host
      const pinned = answers.find((a) => !a.includes(":")) ?? answers[0]!;
      pinnedIps.push(pinned);
      // --- connect to the pinned IP
      let res: TransportResponse;
      try {
        res = await Promise.race([
          transport({ url: current, ip: pinned, port, signal, connectMs: lim.connectMs, headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml", "accept-encoding": "identity", host: current.host } }),
          aborted,
        ]);
      } catch (e) {
        return fail(signal.aborted || (e as Error).message === "TIMEOUT" || (e as Error).name === "AbortError" ? "TIMEOUT" : "FETCH_ERROR", hop);
      }
      if (res.remoteAddress && res.remoteAddress.replace(/^::ffff:/, "") !== pinned.replace(/^::ffff:/, "")) {
        res.destroy();
        return fail("BLOCKED_IP", hop, "remote address differs from the pinned address");
      }
      // --- redirects
      if (res.status >= 300 && res.status < 400) {
        res.destroy();
        const loc = res.headers.location;
        if (!loc) return fail("BAD_STATUS", hop);
        if (hop === lim.maxRedirects) return fail("TOO_MANY_REDIRECTS", hop);
        let next: URL;
        try {
          next = new URL(loc, current);
        } catch {
          return fail("BLOCKED_URL", hop);
        }
        if (current.protocol === "https:" && next.protocol === "http:") return fail("BLOCKED_SCHEME", hop + 1); // downgrade
        current = next;
        continue;
      }
      if (res.status !== 200) { res.destroy(); return fail("BAD_STATUS", hop); }
      if (fo.finalMustBeInside && (current.protocol !== "https:" || !inside(host, fo.finalMustBeInside))) { res.destroy(); return fail("REDIRECT_OFF_DOMAIN", hop); }
      const ctype = (res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      if (ctype !== "text/html" && ctype !== "application/xhtml+xml") { res.destroy(); return fail("BAD_CONTENT_TYPE", hop); }
      const enc = (res.headers["content-encoding"] ?? "identity").toLowerCase();
      if (enc !== "identity") { res.destroy(); return fail("FETCH_ERROR", hop, "content-encoding"); } // we asked for identity
      const declared = Number(res.headers["content-length"] ?? "0");
      if (declared > lim.maxBytes) { res.destroy(); return fail("BODY_TOO_LARGE", hop); }
      // --- bounded body
      const chunks: Buffer[] = [];
      let total = 0;
      try {
        const read = (async () => {
          for await (const c of res.body) {
            total += c.byteLength;
            if (total > lim.maxBytes) throw new Error("BODY_TOO_LARGE");
            chunks.push(Buffer.from(c));
          }
        })();
        await Promise.race([read, aborted]);
      } catch (e) {
        res.destroy();
        const m = (e as Error).message;
        return fail(m === "BODY_TOO_LARGE" ? "BODY_TOO_LARGE" : signal.aborted || m === "TIMEOUT" ? "TIMEOUT" : "FETCH_ERROR", hop);
      }
      return { ok: true, finalUrl: current.toString(), status: 200, body: Buffer.concat(chunks), hops: hop, pinnedIps };
    }
    return fail("TOO_MANY_REDIRECTS", lim.maxRedirects);
  }
  return { fetch: fetchOnce };
}

/** The production factory: public resolvers, real transport, and NO test allowlist (asserted in tests). */
export const createProductionFetcher = (resolver: ResolverLike = createDnsResolver()) => createSafeFetcher({ resolver });
