# M3 QA gate report (task #50, M3-07)

| | |
|---|---|
| **Owner** | QA Engineer (QA_SECURITY) |
| **Branch** | `task/50` |
| **Scope** | M3a: all P0 cases tagged M3 in the catalogue (SEL-*, AZ-007, AZ-010, SEC-007), the SSRF corpus, the cross-seller matrix, regression pins for M3-02 and M3-03 |
| **Catalogue** | [test-case-catalogue.md](./test-case-catalogue.md), section 11 and 11.1 |
| **Gate test** | `apps/web/src/server/m3-gate.test.ts` (19 tests) |

## Verdict

**PASS for M3a, with two conditions.**

1. **SEL-006 is not in the M3a gate.** The catalogue tags it P0 M3, but section 11.1 moves it to M3b under [ADR-0017](../adr/0017-defer-ownership-transfer-and-seller-replies.md), which is pending CEO approval (open item M3-Q3). If the CEO does not accept that deferral, the gate is **FAIL** on SEL-006, because ownership transfer is not built.
2. **E2E is not run here.** The seller Playwright specs need MySQL, Redis, MinIO and a built app, none of which is available in this sandbox. The unit and integration evidence below is from this run. CI's `e2e` job must also pass.

Unit tests ran with `DATABASE_URL` set to the throwaway CI value, because `prisma validate` requires it.

## Evidence (this run)

| Layer | Command | Result |
|---|---|---|
| Lint | `pnpm lint` | pass |
| Typecheck | `pnpm typecheck` | pass (all four packages) |
| Unit, core | `pnpm --filter @rp/core test` | **261 passed** (10 files) |
| Unit, worker | `pnpm --filter @rp/worker test` | **125 passed** (110 before, +15 SSRF corpus entries) |
| Unit, web | `pnpm --filter @rp/web test` | **260 passed** (241 before, +19 `m3-gate.test.ts`) |
| E2E seller specs | `pnpm --filter @rp/web test:e2e` | **not run here**. Runs in CI |

## Per-case results

Result key: **pass** = asserted by a named suite that passes in this run. **deferred** = not in M3a.

| ID | Pri | Result | Evidence (suite, title) |
|---|---|---|---|
| AZ-007 | P0 | **pass** | `packages/core/src/sellers.test.ts` "authorizeSeller (AZ-007, AZ-010)": every permission × role, `SELLER_SUSPENSION` removes it. `apps/web/src/server/sellers.test.ts` "suspend blocks every member", "expired suspension no longer blocks" |
| AZ-010 | P0 | **pass** | `apps/web/src/server/sellers.test.ts` "cross-seller authz, table-driven over every permission (AZ-010, P-2)": every role on seller A is denied on seller B. Client `sellerId` is rejected by the strict schemas. Reply clause is M3b (not gated) |
| SEC-007 | P0 | **pass** | `apps/worker/src/verification/safe-fetch.test.ts` "SEC-007 SSRF corpus" plus DNS rebinding, redirects, limits. Corpus in the table below. **Zero bypasses** in this run |
| SEL-001 | P0 | **pass** | `packages/core/src/claims.test.ts` "challenge (SEL-001)": 256-bit random, unique; another claim's token fails; nothing passes after expiry |
| SEL-002 | P0 | **pass** | `packages/core/src/domain-policy.test.ts` "domain policy (SEL-002)" (106 tests): `gmail.com`, `*.github.io`, `*.shopify`, `*.wixsite` rejected |
| SEL-003 | P0 | **pass** | `packages/core/src/claims.test.ts` "automatic verification and contest (SEL-003, SEL-005)": domain VERIFIED for another seller → CONTESTED; DB unique `verifiedDomainKey` refuses a second VERIFIED claim |
| SEL-004 | P0 | **pass** | `packages/core/src/claims.test.ts` "who decides (SEL-004, SEL-015)" and "staff decisions (SEL-004, ...)": DOCUMENT and MARKETPLACE need a human; second reviewer for brands with a claim or high volume |
| SEL-005 | P0 | **pass** | `packages/core/src/claims.test.ts` (contest notifies via outbox, incumbent untouched); `apps/worker/src/verification/checks.test.ts` "claim notifications (SEL-005)" |
| SEL-006 | P0 | **deferred (M3b)** | Ownership transfer is not built. See ADR-0017 and the verdict above |
| SEL-007 | P0 | **pass** | `apps/web/src/server/sellers.test.ts` "invitations (SEL-007)": 7-day expiry, single use, bound to the verified invitee email; `packages/core/src/sellers.test.ts` "invitation TTL is 7 days" |
| SEL-009 | P0 | **pass** | `apps/web/src/server/seller-views.test.ts` "badge is derived from server state only (SEL-009, SEL-011)": punycode domain shown; badge only when VERIFIED |
| SEL-011 | P0 | **pass** | `apps/web/src/server/sellers.test.ts` "SEL-011: status is VERIFIED only with ..."; `packages/core/src/sellers.test.ts` "computeSellerStatus (SEL-011)". DB backstop: `chk_seller_verified_claim` pinned in `m3-gate.test.ts` (static, see gaps) |
| SEL-012 | P0 | **pass** | `apps/web/src/server/claims.test.ts` "claim submit schema (SEL-012, AZ-010)": PRODUCT needs `productId`. DB backstop: `chk_claim_product_scope` pinned in `m3-gate.test.ts` (static, see gaps) |
| SEL-008 (P1) | P1 | **pass** | `packages/core/src/claims.test.ts` "re-verification, grace and downgrade (SEL-008, SEL-016)"; `apps/worker/src/verification/checks.test.ts` "monthly re-verification ... (SEL-008)" |
| SEL-010 (P1) | P1 | **pass** | `packages/core/src/sellers.test.ts` "name similarity (SEL-010)"; `apps/web/src/server/sellers.test.ts` "flags a name similar to a VERIFIED seller" |

## Regression pins: M3-02 and M3-03

| Task | Case | Result | Evidence |
|---|---|---|---|
| M3-02 | Limiter fails **closed** when Redis is down: login and register | **pass** | `apps/web/src/server/ratelimit.test.ts` "Redis down (R-1)": "login fails CLOSED", "register fails CLOSED"; review writes and upload slots stay fail-open. Pinned in `m3-gate.test.ts` |
| M3-03 | No enumeration on register: new and existing email get an identical response, hashing on both paths | **pass** | `apps/web/src/server/m3-email.test.ts` "registerAccount (SEC-05)": "returns the identical response for a new and an existing email". Pinned in `m3-gate.test.ts` |

Both suites existed before this task. This task adds the pins in `m3-gate.test.ts`, which fail if the suites are removed or renamed. I did not change the behaviour under test.

## SSRF corpus (SEC-007): zero bypasses

Every entry is blocked before any DNS lookup or connection (`connects` and `resolves` are asserted empty).

| Category | Examples | Result |
|---|---|---|
| Loopback | `127.0.0.1`, `127.1`, `2130706433`, `0x7f000001`, `0177.0.0.1`, `0x7f.1`, `127.000.000.001`, `localhost`, `localhost.`, `LOCALHOST` | blocked |
| IPv6 loopback and mapped | `::1`, `[::ffff:127.0.0.1]`, `[::ffff:7f00:1]`, `[0:0:0:0:0:ffff:127.0.0.1]`, `[::127.0.0.1]` | blocked |
| Metadata | `169.254.169.254`, `0xa9fea9fe`, `2852039166`, `[::ffff:a9fe:a9fe]`, `[fd00:ec2::254]` | blocked |
| RFC 1918, ULA, CGNAT, unspecified | `10.0.0.5`, `172.16.0.1`, `172.31.255.255`, `192.168.1.1`, `100.64.0.1`, `[fc00::1]`, `0.0.0.0`, `0`, `[::]` | blocked |
| Zone-id and userinfo | `[fe80::1%25eth0]` (rejected as `BLOCKED_URL`), `user:pw@` | blocked |
| Names that resolve internal | 10.x, 127.0.0.1, 169.254.169.254, 192.168.x, 172.20.x, `::1`, `fd00:ec2::254`, `::ffff:10.0.0.1`, `fe80::1`, `100.100.100.100`; one private answer among public ones | blocked |
| DNS rebinding | answers public at first check and private at the second; connected socket differs from the pinned address; redirect hop re-resolved | blocked |
| Redirects | to internal literals and to names resolving internal; 4th hop; https→http downgrade; off-domain final URL (META) | blocked |
| Ports | 8443, 8080, 22, 3306, and 443/80 on the wrong scheme | blocked |
| Limits | body over 1 MB (streamed and declared), 5 s on a silent server and a stalled body, non-HTML and compressed bodies | blocked or capped |

The corpus gained 15 encoding variants in this task. None got through. One (`[fe80::1%25eth0]`) is rejected earlier, as `BLOCKED_URL`, and is asserted separately.

## Open S1 and S2 bugs

**None found in this run.** No corpus entry or case above produced a bypass or a wrong result.

## P1 cases and tickets

| ID | Status | Ticket |
|---|---|---|
| SEL-008 | pass | none needed |
| SEL-010 | pass | none needed |

No P1 M3 case is failing, so there are no open P1 tickets. I have no access to the ticket tracker from this sandbox, so none were filed.

Proposed P1 cases from the catalogue (SEC-016, and SEL-017 to SEL-019 and SEC-015) are not counted in the gate, and I did not assess them.

## Gaps and risks

1. **SEL-006** is deferred to M3b. It is P0 in the catalogue, so the verdict depends on the CEO accepting ADR-0017.
2. **E2E is not run here.** Seller UI and API flows (`apps/web/e2e/seller.spec.ts`) need the CI services.
3. **DB CHECKs for SEL-011 and SEL-012 are pinned statically.** `m3-gate.test.ts` reads the migration SQL. It does not run the constraints against MySQL 8. A live check belongs in the CI e2e job.
4. **The SSRF corpus uses a fake transport and resolver.** The production socket path is covered by the factory test (the test allowlist is constructor-only) but not by a live network test. The production connect-to-pinned-address behaviour is not exercised end to end here.
5. **`prisma validate` needs `DATABASE_URL`.** The CI value is a throwaway, and the same value works locally.

## Reproduce

```bash
export DATABASE_URL=mysql://app:app@127.0.0.1:3306/ci
pnpm lint && pnpm typecheck && pnpm -r --no-bail test
pnpm --filter @rp/web exec vitest run src/server/m3-gate.test.ts
pnpm --filter @rp/worker exec vitest run src/verification/safe-fetch.test.ts
```
