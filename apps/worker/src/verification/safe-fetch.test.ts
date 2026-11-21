import { describe, expect, it } from "vitest";
import { createProductionFetcher, createSafeFetcher, type Transport, type TransportResponse } from "./safe-fetch";

const html = (body = "<html><head></head></html>") => [Buffer.from(body)];
const ok = (over: Partial<TransportResponse> & { chunks?: Uint8Array[] } = {}): TransportResponse => {
  const { chunks, ...rest } = over;
  return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: (async function* () { for (const c of chunks ?? html()) yield c; })(), destroy: () => undefined, ...rest };
};
const redirect = (to: string): TransportResponse => ok({ status: 302, headers: { location: to } });

/** Fake world: `dns` maps host -> answers (per call, so rebinding can be scripted), `pages` maps url -> response factory. Records every connection. */
function world(dns: Record<string, string[] | string[][]>, pages: Record<string, () => TransportResponse>) {
  const resolves: string[] = [];
  const connects: Array<{ url: string; ip: string; port: number }> = [];
  const calls: Record<string, number> = {};
  const resolver = {
    async resolve(host: string) {
      resolves.push(host);
      const v = dns[host];
      if (!v) return [];
      const n = (calls[host] = (calls[host] ?? -1) + 1);
      return Array.isArray(v[0]) ? (v as string[][])[Math.min(n, v.length - 1)]! : (v as string[]);
    },
  };
  const transport: Transport = async (r) => {
    connects.push({ url: r.url.href, ip: r.ip, port: r.port });
    const p = pages[r.url.href];
    if (!p) throw new Error("unexpected connection");
    return p();
  };
  return { f: createSafeFetcher({ resolver, transport }), resolves, connects };
}
const PUB = "93.184.216.34";

describe("SEC-007 SSRF corpus: everything internal is blocked before any connection", () => {
  const literals = [
    "http://127.0.0.1/", "http://127.1/", "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://169.254.169.254/latest/meta-data/",
    "http://[fd00:ec2::254]/", "http://10.0.0.5/", "http://172.16.0.1/", "http://192.168.1.1/", "http://100.64.0.1/", "http://0.0.0.0/", "http://localhost/", "http://metadata/", "http://intranet/",
    // Encoding bypasses (M3-07 corpus): hex/decimal IPv6-mapped forms, zero host, trailing-dot and case variants, ULA, link-local zone.
    "http://[::ffff:7f00:1]/", "http://[0:0:0:0:0:ffff:127.0.0.1]/", "http://[::ffff:a9fe:a9fe]/", "http://[::127.0.0.1]/", "http://[::]/", "http://0/", "http://0xa9fea9fe/", "http://2852039166/",
    "http://localhost./", "http://LOCALHOST/", "http://[fc00::1]/", "http://172.31.255.255/", "http://0x7f.1/", "http://127.000.000.001/",
  ];
  it.each(literals)("blocks %s", async (u) => {
    const w = world({}, {});
    const r = await w.f.fetch(u);
    expect(r).toMatchObject({ ok: false, error: "BLOCKED_HOST" });
    expect(w.connects).toHaveLength(0);
    expect(w.resolves).toHaveLength(0);
  });
  it("blocks an IPv6 zone-id literal (fe80::1%25eth0) before any lookup or connection", async () => {
    const w = world({}, {});
    const r = await w.f.fetch("http://[fe80::1%25eth0]/");
    expect(r).toMatchObject({ ok: false, error: "BLOCKED_URL" });
    expect(w.connects).toHaveLength(0);
    expect(w.resolves).toHaveLength(0);
  });
  it.each(["10.0.0.5", "127.0.0.1", "169.254.169.254", "192.168.0.10", "172.20.1.1", "::1", "fd00:ec2::254", "::ffff:10.0.0.1", "fe80::1", "100.100.100.100"])("a public-looking name that resolves to %s is blocked", async (ip) => {
    const w = world({ "evil.example.com": [ip] }, {});
    expect(await w.f.fetch("https://evil.example.com/")).toMatchObject({ ok: false, error: "BLOCKED_IP" });
    expect(w.connects).toHaveLength(0);
  });
  it("one private answer among public ones blocks the whole host", async () => {
    const w = world({ "mixed.example.com": [PUB, "10.0.0.1"] }, {});
    expect(await w.f.fetch("https://mixed.example.com/")).toMatchObject({ ok: false, error: "BLOCKED_IP" });
  });
  it.each(["file:///etc/passwd", "ftp://example.com/", "gopher://example.com/", "javascript:alert(1)", "data:text/html,x"])("blocks scheme %s", async (u) => {
    expect(await world({}, {}).f.fetch(u)).toMatchObject({ ok: false });
  });
  it.each(["https://example.com:8443/", "http://example.com:8080/", "https://example.com:22/", "http://example.com:443/", "https://example.com:80/", "http://example.com:3306/"])("blocks port in %s", async (u) => {
    const w = world({ "example.com": [PUB] }, {});
    expect(await w.f.fetch(u)).toMatchObject({ ok: false, error: "BLOCKED_PORT" });
    expect(w.connects).toHaveLength(0);
  });
  it("blocks userinfo", async () => {
    expect(await world({ "example.com": [PUB] }, {}).f.fetch("https://user:pw@example.com/")).toMatchObject({ ok: false, error: "BLOCKED_URL" });
  });
  it("allows the default ports explicitly", async () => {
    const w = world({ "example.com": [PUB] }, { "https://example.com/": () => ok() });
    expect(await w.f.fetch("https://example.com:443/")).toMatchObject({ ok: true });
  });
});

describe("DNS rebinding", () => {
  it("connects only to the pinned (validated) address and never re-resolves the hop", async () => {
    // First answer is public; any second lookup would be private. The fetch must use the first and look up once.
    const w = world({ "rebind.example.com": [[PUB], ["127.0.0.1"], ["127.0.0.1"]] }, { "https://rebind.example.com/": () => ok() });
    const r = await w.f.fetch("https://rebind.example.com/");
    expect(r).toMatchObject({ ok: true, pinnedIps: [PUB] });
    expect(w.resolves).toEqual(["rebind.example.com"]);
    expect(w.connects).toEqual([{ url: "https://rebind.example.com/", ip: PUB, port: 443 }]);
  });
  it("a rebind that answers private at check time is blocked", async () => {
    const w = world({ "rebind.example.com": [["127.0.0.1"], [PUB]] }, {});
    expect(await w.f.fetch("https://rebind.example.com/")).toMatchObject({ ok: false, error: "BLOCKED_IP" });
  });
  it("a redirect hop is resolved and validated again: public first hop, rebinding second hop", async () => {
    const w = world({ "a.example.com": [PUB], "b.example.com": [["127.0.0.1"]] }, { "https://a.example.com/": () => redirect("https://b.example.com/x") });
    expect(await w.f.fetch("https://a.example.com/")).toMatchObject({ ok: false, error: "BLOCKED_IP", hop: 1 });
    expect(w.connects.map((c) => c.ip)).toEqual([PUB]);
  });
  it("blocks when the connected socket's remote address differs from the pinned one", async () => {
    const w = world({ "example.com": [PUB] }, { "https://example.com/": () => ok({ remoteAddress: "127.0.0.1" }) });
    expect(await w.f.fetch("https://example.com/")).toMatchObject({ ok: false, error: "BLOCKED_IP" });
  });
});

describe("redirects", () => {
  const internal = ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://localhost:8080/", "http://10.1.1.1/admin", "http://2130706433/", "file:///etc/passwd", "gopher://example.com/"];
  it.each(internal)("a redirect to %s is blocked and never connected", async (to) => {
    const w = world({ "example.com": [PUB] }, { "https://example.com/": () => redirect(to) });
    const r = await w.f.fetch("https://example.com/");
    expect(r).toMatchObject({ ok: false });
    expect(w.connects).toHaveLength(1);
  });
  it("a redirect to a name that resolves to an internal address is blocked", async () => {
    const w = world({ "example.com": [PUB], "internal.example.org": ["10.0.0.9"] }, { "https://example.com/": () => redirect("https://internal.example.org/") });
    expect(await w.f.fetch("https://example.com/")).toMatchObject({ ok: false, error: "BLOCKED_IP" });
  });
  it("follows up to 3 redirects (relative Location too) and refuses the 4th", async () => {
    const hops = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`https://example.com/${i === 0 ? "" : i}`, () => redirect(`/${i + 1}`)]));
    const three = world({ "example.com": [PUB] }, { ...hops(3), "https://example.com/3": () => ok() });
    expect(await three.f.fetch("https://example.com/")).toMatchObject({ ok: true, hops: 3, finalUrl: "https://example.com/3" });
    const four = world({ "example.com": [PUB] }, { ...hops(4), "https://example.com/4": () => ok() });
    expect(await four.f.fetch("https://example.com/")).toMatchObject({ ok: false, error: "TOO_MANY_REDIRECTS" });
  });
  it("refuses an https -> http downgrade", async () => {
    const w = world({ "example.com": [PUB] }, { "https://example.com/": () => redirect("http://example.com/") });
    expect(await w.f.fetch("https://example.com/")).toMatchObject({ ok: false, error: "BLOCKED_SCHEME" });
  });
  it("META: a final URL on another site proves nothing (REDIRECT_OFF_DOMAIN); a subdomain is fine", async () => {
    const off = world({ "acme.com": [PUB], "other.com": [PUB] }, { "https://acme.com/": () => redirect("https://other.com/"), "https://other.com/": () => ok() });
    expect(await off.f.fetch("https://acme.com/", { finalMustBeInside: "acme.com" })).toMatchObject({ ok: false, error: "REDIRECT_OFF_DOMAIN" });
    const sub = world({ "acme.com": [PUB], "www.acme.com": [PUB] }, { "https://acme.com/": () => redirect("https://www.acme.com/"), "https://www.acme.com/": () => ok() });
    expect(await sub.f.fetch("https://acme.com/", { finalMustBeInside: "acme.com" })).toMatchObject({ ok: true });
    const lookalike = world({ "acme.com": [PUB], "evilacme.com": [PUB] }, { "https://acme.com/": () => redirect("https://evilacme.com/"), "https://evilacme.com/": () => ok() });
    expect(await lookalike.f.fetch("https://acme.com/", { finalMustBeInside: "acme.com" })).toMatchObject({ ok: false, error: "REDIRECT_OFF_DOMAIN" });
  });
});

describe("limits", () => {
  it("caps the body at 1 MB while streaming", async () => {
    const big = Array.from({ length: 5 }, () => Buffer.alloc(300_000, 97));
    const w = world({ "example.com": [PUB] }, { "https://example.com/": () => ok({ chunks: big }) });
    expect(await w.f.fetch("https://example.com/")).toMatchObject({ ok: false, error: "BODY_TOO_LARGE" });
  });
  it("accepts a body at exactly the cap and rejects a declared oversize Content-Length before reading", async () => {
    const exact = world({ "example.com": [PUB] }, { "https://example.com/": () => ok({ chunks: [Buffer.alloc(1_048_576, 97)] }) });
    expect(await exact.f.fetch("https://example.com/")).toMatchObject({ ok: true });
    let read = false;
    const decl = world({ "example.com": [PUB] }, { "https://example.com/": () => ok({ headers: { "content-type": "text/html", "content-length": "2000000" }, body: (async function* () { read = true; yield Buffer.from("x"); })() }) });
    expect(await decl.f.fetch("https://example.com/")).toMatchObject({ ok: false, error: "BODY_TOO_LARGE" });
    expect(read).toBe(false);
  });
  it("times out when the server never answers, and when the body stalls (5 s budget, shortened here)", async () => {
    const hang = createSafeFetcher({ resolver: { resolve: async () => [PUB] }, transport: () => new Promise(() => undefined), limits: { totalMs: 60 } });
    expect(await hang.fetch("https://example.com/")).toMatchObject({ ok: false, error: "TIMEOUT" });
    const slow = createSafeFetcher({ resolver: { resolve: async () => [PUB] }, transport: async () => ok({ body: (async function* () { yield Buffer.from("a"); await new Promise(() => undefined); })() }), limits: { totalMs: 60 } });
    expect(await slow.fetch("https://example.com/")).toMatchObject({ ok: false, error: "TIMEOUT" });
    const slowDns = createSafeFetcher({ resolver: { resolve: () => new Promise(() => undefined) }, limits: { totalMs: 60 } });
    expect(await slowDns.fetch("https://example.com/")).toMatchObject({ ok: false, error: "TIMEOUT" });
  });
  it("the default budget is 5 s, 1 MB, 3 redirects", async () => {
    const { FETCH_LIMITS } = await import("./safe-fetch");
    expect(FETCH_LIMITS).toMatchObject({ totalMs: 5000, maxBytes: 1_048_576, maxRedirects: 3 });
  });
  it("only HTML 200 responses are accepted, and no compressed bodies", async () => {
    const t = (over: Partial<TransportResponse>) => world({ "example.com": [PUB] }, { "https://example.com/": () => ok(over) }).f.fetch("https://example.com/");
    expect(await t({ status: 404 })).toMatchObject({ ok: false, error: "BAD_STATUS" });
    expect(await t({ status: 500 })).toMatchObject({ ok: false, error: "BAD_STATUS" });
    expect(await t({ headers: { "content-type": "application/octet-stream" } })).toMatchObject({ ok: false, error: "BAD_CONTENT_TYPE" });
    expect(await t({ headers: { "content-type": "text/html", "content-encoding": "gzip" } })).toMatchObject({ ok: false, error: "FETCH_ERROR" });
  });
  it("sends a fixed header set: no cookies, auth or referer", async () => {
    let headers: Record<string, string> = {};
    const f = createSafeFetcher({ resolver: { resolve: async () => [PUB] }, transport: async (r) => { headers = r.headers; return ok(); } });
    await f.fetch("https://example.com/");
    expect(Object.keys(headers).sort()).toEqual(["accept", "accept-encoding", "host", "user-agent"]);
    expect(headers["accept-encoding"]).toBe("identity");
  });
});

describe("test allowlist", () => {
  it("is a constructor-only option: the production factory (and any env) cannot allow loopback", async () => {
    const prod = createProductionFetcher({ resolve: async () => ["127.0.0.1"] });
    expect(await prod.fetch("https://example.com/")).toMatchObject({ ok: false, error: "BLOCKED_IP" });
    process.env.UNSAFE_TEST_ALLOWLIST = "127.0.0.1";
    expect(await createProductionFetcher({ resolve: async () => ["127.0.0.1"] }).fetch("https://example.com/")).toMatchObject({ ok: false, error: "BLOCKED_IP" });
    delete process.env.UNSAFE_TEST_ALLOWLIST;
    const t = createSafeFetcher({ resolver: { resolve: async () => ["127.0.0.1"] }, transport: async () => ok(), unsafeTestAllowlist: ["127.0.0.1"] });
    expect(await t.fetch("https://example.com/")).toMatchObject({ ok: true });
  });
});
