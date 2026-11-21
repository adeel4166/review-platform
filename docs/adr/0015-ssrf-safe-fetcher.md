# ADR-0015: SSRF-safe website fetcher in an isolated worker group

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-21 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #44 (M3-01) |
| **Related** | [m3-sellers-spec.md §6](../architecture/m3-sellers-spec.md), threat model O-5 and U-10, catalogue SEC-007/SEC-015/SEC-016, ADR-0007 §6 (deployment groups), ADR-0014 |

## Context

The META_TAG method makes the platform send HTTP requests to hosts chosen by claimants. Without controls this is
server-side request forgery (O-5, **Critical**): cloud metadata (`169.254.169.254`, `fd00:ec2::254`), internal
services, DNS rebinding and redirect chains to internal hosts. The draft only said "SSRF-safe fetcher".

## Decision

1. **Only the server builds URLs:** `https://<domain>/` and `https://www.<domain>/` from a domain that passed the
   claim domain policy. No user-supplied URL is fetched (`websiteUrl` and `evidenceUrl` are never fetched).
2. **Resolve, validate, pin, connect.** Resolve A/AAAA through configured public resolvers. **Every** answer must be
   public unicast, or the host is blocked. The socket connects to the pinned IP through a custom `lookup`, TLS checks
   the hostname, and after connect we assert `remoteAddress === pinned`. The name is never resolved again for that hop.
3. **Deny loopback, link-local, RFC 1918, CGNAT, documentation, multicast, reserved and their IPv6 equivalents**
   (ULA, link-local, site-local, Teredo, 6to4, NAT64 and v4-mapped after unwrapping). The full table is in spec §6.3.
   Anything not explicitly public unicast is denied.
4. **Ports 80/443 only**, matching the scheme. No userinfo. GET only. No cookies, auth, Referer or proxy environment.
5. **At most 3 redirects**, each fully re-validated (scheme, port, host, new resolve, new pin). https → http is
   refused. For META_TAG the final URL must be https and inside the claimed domain.
6. **5 s total timeout** (one abort signal over DNS, connect, TLS, hops and body), 2 s per connect. **1 MB body cap**
   on both compressed and decompressed bytes. HTML content types only.
7. **Isolation:** the fetcher and DNS lookups run only in a new `verification-egress` worker group. Its environment
   has only a Redis ACL user scoped to two queues and the resolver list: **no database, storage or SMTP
   secrets**, checked at startup. Results return as a bounded job payload that the core group applies. A network
   policy denying private and metadata ranges is defence in depth.
   Implemented in M3b-02: see [verification-egress.md](../security/verification-egress.md).
8. The web app cannot import the fetcher (ESLint rule).

## Alternatives considered

| Option | Why not |
|---|---|
| Plain `fetch()` with a hostname deny-list | Bypassed by DNS rebinding, decimal or hex IPs, redirects and IPv6 forms |
| Validate after resolving, then let `fetch` resolve again | A time-of-check/time-of-use gap: the classic rebinding bypass |
| An egress forward proxy (e.g. Smokescreen) as the only control | Good defence in depth, but it is an extra service with its own config. In-app pinning is testable in CI. The proxy stays an M8 option (M3-Q13) |
| Run the fetcher in the core worker | A bypass would reach a process holding DB and storage credentials |
| Fetch marketplace pages automatically | Marketplace URLs are user-supplied and the hosts are third parties. A human check needs no server fetch (U-10) |

## Consequences

**Positive:** The SEC-007 corpus can be run as a deterministic test with injected resolvers. A fetcher bug would not
expose secrets.

**Negative / risks:** One more deployment group and Redis ACL to operate. Sites behind bot protection may fail META
checks, so those sellers fall back to DNS_TXT. Public resolvers add an external dependency, which is configurable.

## Follow-ups

- M3-05 builds the fetcher and corpus. DevOps writes the network policy with the hosting decision (C-9/T-1).
