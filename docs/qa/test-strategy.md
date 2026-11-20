# Phase 1 Test Strategy

| | |
|---|---|
| **Status** | Draft for review (task #23, milestone M1.6) |
| **Owner** | QA Engineer (QA_SECURITY) |
| **Test case catalogue** | [test-case-catalogue.md](./test-case-catalogue.md): every case ID used in this document lives there |
| **Related** | [ADR-0001](../adr/0001-technology-stack.md) (Vitest + Playwright) · [ADR-0003](../adr/0003-multi-role-permissions.md) §5 (matrix tests) · [moderation-pipeline.md](../architecture/moderation-pipeline.md) §13 · [media-pipeline.md](../architecture/media-pipeline.md) §11 · [threat-model.md](../security/threat-model.md) §8 · [a11y checklist](../../design/a11y-checklist.md) |

This is the test strategy for Phase 1 (everything except messaging). It defines the test levels, the tooling, the
rules every test must follow, the designs for the highest-risk areas (moderation state machine, the 24 h and 7-day
timers, media pipeline fixtures, the role/permission matrix), and the QA gate each feature milestone must pass.

It is a plan for the implementation milestones. No test harness is added by this task: the integration and E2E
scaffolding lands with M2 (see §10).

---

## 1. Goals and scope

1. **Prove the M1 designs in code.** Each design document already states its own test plan. This strategy turns those
   plans into one catalogue, with stable IDs, so every feature milestone can be gated against it.
2. **Fail closed.** Any path where a violating review goes live, a malicious file is served, or a role gains access
   it should not have is a release blocker (S1). The tests are written to catch those paths first.
3. **Stay out of the way of feature work.** Most cases are unit tests on pure logic, which is cheap to run on every PR.
   Only journeys that cross web, worker and storage go to E2E.

**In scope:** moderation and content state machine, AI verdicts and failure handling, timers, configuration, media
pipeline, storage and upload, authorization, authentication, outbox and queues, privacy of proof data, seller
ownership, trust and social features, accessibility, security checks, operational checks before launch.

**Out of scope:** messaging (Phase 2). One scope test (`SCOPE-001`) asserts that no messaging permission or route
exists, so the boundary is tested too. Load and performance testing is planned for M8 and is not specified here.

---

## 2. Test levels and the split

| Level | What it proves | Tooling | Location | Needs services | Runs |
|---|---|---|---|---|---|
| **Unit** | Pure logic: state transitions, classification, authz decisions, config validation, job payload schemas, outbox routing | Vitest | `packages/*/src/**/*.test.ts` | No | Every PR (`pnpm test`, part of `pnpm qa`) |
| **Integration** | DB constraints and transactions, outbox atomicity, timers with a fake clock, queue processors, media stages with real libvips, ffmpeg, clamd and exiftool, storage presign / HEAD / promote | Vitest, files named `*.int.test.ts` | `packages/*/test/integration/` | MySQL 8, Redis 7, MinIO, ClamAV, exiftool | Every PR via CI service containers (from M2). Full run nightly |
| **E2E** | User and staff journeys in a real browser, keyboard paths, the timer journeys seen from the UI | Playwright | `apps/web/e2e/` | Web, worker, all infra | Smoke subset on PR (P0 only). Full run nightly and before each gate |
| **Security checks** | Rules enforced in code or CI: route and action registry coverage, lint bans, headers, rate-limit registry, dependency audit, secret scan, SAST, attack corpora (SSRF, XSS, injection canaries) | Vitest, ESLint custom rules, CI scanners | `tests/security/` and `apps/*/test/security/` | Varies | Every PR |
| **Accessibility** | axe scans per route and state, component label checks, keyboard paths, WCAG 2.2 AA items | jest-axe (components), @axe-core/playwright (pages), Playwright (keyboard) | With unit and E2E | None for jest-axe | Every PR (components). E2E per milestone |
| **Design tokens** | Token drift and contrast | Existing `pnpm design:check` | `design/` | No | Every PR (already in CI today) |

**Split rule of thumb.** If a behaviour can be expressed as a function of (state, event, clock, config), it is a unit
test. If it depends on the database enforcing something, a queue delivering a job twice, or a real file format, it is
an integration test. If a user can see it in a browser, it may have one E2E test, and only one: the journey, not
every branch.

**Time budgets (proposed, enforced by CI timeouts):** unit suite under 60 s; integration suite under 10 min; E2E smoke
under 10 min; full nightly under 45 min.

**Coverage.** There is no global line-coverage target. Line coverage says little about a state machine or an authz
matrix. The gate uses **structural coverage** instead: 100 % of the 315 matrix cells (`AZ-001`), 100 % of the
moderation transition rows (`MOD-001` to `MOD-015`), 100 % of the timers in §5.2, and 100 % of the media fixtures in §5.3.

---

## 3. Tooling decisions

- **Vitest** for unit and integration, as already set up in `packages/core`, `apps/worker` and `apps/web`.
- **Playwright** for E2E (ADR-0001). Browser time can be controlled with the Playwright clock API for UI-only checks.
- **jest-axe** for component accessibility and **@axe-core/playwright** for page scans. Both are named in
  `design/a11y-checklist.md`. They are not yet in `package.json`; M2 adds them.
- **exiftool** in CI and in the worker test image, for metadata assertions (`media-pipeline.md` §11).
- **Real ClamAV (clamd)** in integration tests. Unit tests use a `Scanner` fake that returns INFECTED for the EICAR string.
- **Fake clock.** Domain services receive a `Clock` interface. Tests inject a `FakeClock`; production uses system time.
  Deadlines are computed from the app clock and stored as absolute UTC values. Tests must **not** rely on database
  `NOW()` for deadlines, because a fake app clock cannot drive them (`TMR-014`).
- **Server-side test clock for E2E.** The E2E journey for hold expiry needs the server to see a later time. A test-only
  clock override is allowed only when `NODE_ENV=test`, and it must be absent from production builds (`OPS-003`).
  Waiting seven real days is not an option.
- **AI provider is always faked in CI.** A fake returns scripted verdicts and failure modes and records every payload it
  receives. Contract tests against a real provider belong to the provider spike (T-4), not to PR CI.

---

## 4. Rules for every test

1. **Test IDs in titles.** Every test title starts with its catalogue ID (`MOD-007 reject requires policy reasonCode`),
   so CI reports link straight back to the catalogue.
2. **No wall clock, no network, no randomness without a seed.** Use `FakeClock` and seeded random data. Integration
   tests may use MinIO, MySQL, Redis and ClamAV, and nothing else.
3. **Test data is safe.**
   - Integration tests refuse to run unless the `DATABASE_URL` host is `localhost`, `127.0.0.1` or the CI service, and
     the database name ends with `_test`.
   - Tests clean up with rolled-back transactions or per-file schemas. No test drops or truncates a database it did not
     create. Destructive commands are not part of any test script.
4. **No real secrets.** Test environments use the throwaway values in `.env.example`, and tests never read `.env` files.
5. **PII canaries.** Tests that touch proofs, reviews or logs seed a random canary string (`RP_CANARY_<hex>`). The
   canary must not appear in any log, outbox row, job payload, error payload or AI assessment row (`PRV-001`).
6. **Malicious fixtures are generated, not committed.** See §5.3.
7. **Expected values come from the design docs, not from the code.** When a design doc is ambiguous, the test records
   the assumption (§9) and the expected value the assumption implies. A test must never be written to match whatever
   the code does today.
8. **Every bug found gets a test.** A regression case is added to the catalogue with the next free ID in its family.

---

## 5. Designs for the highest-risk areas

### 5.1 Moderation state machine (`MOD-*`, `CLS-*`, `AIF-*`)

- **Table-driven from the spec.** One test per row of `moderation-pipeline.md` §3.2 (T1–T14) and per edit row of §3.3.
  Each asserts the target status, decision source, outcome and verdict, lane, timer fields, outbox topics and
  notification type. The rows are the specification, so a changed row fails the test.
- **Negative matrix.** The test enumerates every (ContentStatus × event) pair, minus the rows listed in the spec. Every
  unlisted pair must throw `InvalidTransition` and write nothing. The event list is a fixture, and it is checked against
  the enum so a new event cannot skip the test.
- **Idempotency.** Applying the same event twice produces one state change, one outbox row and one notification (§4.3).
- **Classification** is tested as a truth table with boundary values (`score == clean`, `score == violation`, one step
  either side). Precedence follows `moderation-pipeline.md` §2.2: a violation beats a force-unsure rule.
- **Failure injection.** A scripted fake provider produces timeout, 429, 5xx, malformed output and unsupported language.
  A property test asserts that **no failure path can produce CLEAN**. This is the most important safety property in
  the system, so it is run on every PR.
- **Configuration bounds** (`CFG-*`) and hard floors: zero-tolerance categories and force-unsure rules cannot be
  disabled by config, even if validation is bypassed.

### 5.2 Timers: the 24 h and 7-day rules (`TMR-*`)

The brief's "24 h" and "7-day auto-reject" map to these timers in `moderation-pipeline.md` §4.1:

| Timer | Starts | Deadline | Effect | Behaviour to test |
|---|---|---|---|---|
| Post-review SLA | Content goes live (CLEAN) | +24 h | Staffing SLA only. Not a state change | Deadline is exact. Breach counter fires after the deadline. Content stays live. CLEAN content is **live immediately**, not after 24 h |
| Post-review lapse | `postReviewDueAt` | +144 h (7 days after go-live) | Case auto-closed as APPROVE. Content stays live | Not before the deadline. Counter increments |
| **Hold expiry** | Content hidden (UNSURE) | **+7 days** | **Auto-reject** (RULE, `HOLD_EXPIRED`). Notice says "not reviewed in time". Appeal window opens. **No strike, no trust penalty** | Fires at `now ≥ holdExpiresAt`. One millisecond before is a no-op. Stored in UTC. Holds across DST changes |
| Hold reminder | `holdExpiresAt − 48 h` | 48 h before expiry | Priority bump only | Idempotent |
| AI pending guard | Case created | +10 min | Forces UNSURE (lost job) | Exact at 10 min |
| Appeal window | Decision (T3, T6, T7, T9) | +30 days | Appeal button disappears | Accepted at −1 s, refused at +1 s |
| Appeal SLA | Appeal submitted | 72 h (`HOLD_EXPIRED`) or 168 h | Priority bump, alert | Stored per appeal |

**Timer rules tested everywhere they apply:**

- **Boundaries.** Timers fire at `now ≥ deadline`.
- **Frozen deadlines.** The deadline is stored when the timer starts. A later config change does not move it (`TMR-008`).
- **Stateless jobs.** A timer job re-reads the case and does nothing if the case is resolved, superseded or has a
  different deadline (`TMR-013`).
- **Sweeper backstop.** If the delayed job is lost (for example Redis is flushed), a sweeper resolves an overdue case
  within one sweep interval (`TMR-007`).
- **Races.** A human approve and a hold expiry at the same millisecond produce exactly one commit, and one notification
  (`TMR-006`, `MOD-021`).
- **Re-scan versus edit.** A recovery re-scan does not reset the hold clock (`TMR-009`). An author edit starts a new
  clock and the old job becomes a no-op (`TMR-010`).

### 5.3 Media pipeline fixtures (`MED-*`)

**Fixture families** (boundary and malicious cases are required, not optional):

- **Size:** exact limit, limit + 1 byte, for photo (10 MB), video (50 MB) and PDF (10 MB, 20 pages).
- **Pixels and duration:** decompression bomb (small file, huge decoded size), a 50 MP photo, a 4096 px video and a
  4200 px video, duration at 30.0 s, 30.4 s and 31 s.
- **Type and format:** magic-byte mismatches (PNG named `.jpg`, executable named `.jpg`), polyglot (JPEG + ZIP), SVG
  with script, GIF, BMP, TIFF, animated WebP, truncated JPEG, WebM, PDF used as a photo.
- **Metadata:** JPEG with GPS EXIF, PNG with XMP and IPTC, HEIC with GPS, iPhone MOV with HEVC, HDR, location atom and
  rotation.
- **Malware:** the EICAR test string (the standard anti-malware test string, which is not malware) as a stand-alone
  file, embedded at 30 MB in a 40 MB file (regression for ClamAV's 25 MB default), and a banned SHA-256.

**Generation.** Fixtures are generated at test time by a script in `test/fixtures/media/`. They are not committed,
for three reasons: 10 MB and 50 MB blobs bloat the repository; a committed EICAR file trips antivirus software on
developer machines and on the hosting platform; and a generator is deterministic and reviewable.

**Assertions.** Every fixture asserts the outcome (`READY` or the `REJECTED` / `FAILED` reason), the bucket it ends in,
and that no metadata survives in any output (checked with exiftool). A malicious fixture also asserts quarantine,
the scan log with signature version, and the parent-moderation effect (`MED-012`).

**Fail-closed assertion.** Nothing decodes before the virus scan passes (`media-pipeline.md` §4.1). A test makes the
scanner unreachable and asserts that the object never reaches the public bucket (`MED-014`).

### 5.4 Role and permission matrix (`AZ-*`, `SCOPE-001`)

- **Matrix cells.** ADR-0003 §2 has **35 permission rows × 9 role columns = 315 cells**. Every cell is one generated
  test asserting allow or deny. Every ◐ cell gets two tests: the condition met (allow) and not met (deny with the reason
  named in the guard column).
- **One source of truth.** The matrix is kept as data in `packages/core/src/authz/`. A test parses the ADR table and
  fails if the ADR and the code disagree. ADR-0003 §5 says a matrix change must update the ADR in the same PR, and this
  test enforces it.
- **Guards** are tested in the order of ADR-0003 §3 (deny wins): session, account state, 2FA gate, role/scope, ownership
  and relationship, COI, step-up, block rule. Order-of-evaluation tests ensure the first failing guard's reason is returned.
- **Route coverage.** Every Server Action, Route Handler and worker job must be registered with a permission. A test
  enumerates them and fails on any unregistered entry. A lint rule bans bare Server Actions and direct Prisma calls from
  components and route handlers (threat-model P-1).
- **Pending-2FA sessions** are denied on every route, action and job (`AZ-009`). This is generated from the same registry.

### 5.5 Security verification harnesses

Threat-model §8 asks for at least one automated test or CI check for every Critical and High threat. The harnesses and
their catalogue cases:

| Harness | Cases |
|---|---|
| Authorization matrix and route registry | `AZ-001`, `AZ-020`, `AZ-021` |
| Rate-limit registry coverage and limits | `SEC-003`, `SEC-004` |
| Malicious-file corpus (bombs, polyglots, EXIF/GPS, malformed HEIC/MP4) | `MED-*` |
| SSRF corpus (private IPs, DNS rebinding, redirects) | `SEC-007` |
| XSS corpus across every rendered user field | `SEC-006` |
| PII canary | `PRV-001` |
| Prompt-injection canaries for the moderation classifier | `SEC-008` |
| Headers, CSP, cookies, CSRF | `SEC-001`, `AUT-010`, `AUT-012` |

The full Critical and High mapping is in the catalogue (§"Threat coverage").

### 5.6 Accessibility

- **Per route and per state** listed in the wireframes (`design/wireframes/`), an axe scan must show **0 serious or critical
  violations** (`A11Y-001`). This follows `design/a11y-checklist.md`.
- **Keyboard-only paths** are E2E tests for flows 01 (auth), 03 (write review) and 07 (admin queue decide flow).
- **Components** have jest-axe tests for labels and error association.
- **Contrast and tokens** are already enforced by `pnpm design:check`.

---

## 6. QA gate criteria per milestone

Each gate is passed when **all P0 cases tagged with that milestone** in the catalogue pass in CI, plus the extra
criteria below, and **no open S1 or S2 bug** is assigned to the milestone. P1 cases must have a ticket before the gate.
P2 cases are backlog.

Milestone mapping follows the **assumed** mapping in [threat-model.md](../security/threat-model.md) §0, because the
repository does not define M2–M8. If the PM plan differs, only the milestone column of the catalogue changes.

| Milestone | Scope | Extra gate criteria |
|---|---|---|
| **M1.6** (this task) | Strategy and catalogue | Catalogue linked to M2–M8. Doc review by the Architect. Standard `pnpm qa` green |
| **M2** Identity and auth | Sessions, 2FA, `authorize()`, rate-limit registry, headers, audit | Full authz matrix (`AZ-001`, 315 cells) and all guard cases `AZ-003` to `AZ-019`. Route-registry and lint gates (`AZ-020`, `AZ-021`). All `AUT-*` P0. Header, dependency-audit and secret-scan gates (`SEC-001`, `SEC-002`). Keyboard path for sign-in (`A11Y-002`). Integration harness live in CI with service containers. Test DB safety guard (`INF-005`) |
| **M3** Catalog and sellers | Products, sellers, ownership proof | Full `SEL-*` P0. SSRF corpus (`SEC-007`) with **zero** bypasses. Cross-seller tests for every seller permission (`AZ-010`) |
| **M4** Reviews, votes, verified-buyer proof | Review submit, votes, proofs | `E2E-001`, `E2E-010`. `MOD-019` (live edit). `PRV-*` P0 including the canary test (`PRV-001`) and redaction fail-closed (`PRV-005`). Vote and rate-limit tests (`SEC-004`, `SEC-009`). XSS corpus (`SEC-006`). Keyboard path for writing a review (`A11Y-003`) |
| **M5** Media upload and processing | Upload slots, scan, sanitise, transcode, storage | **All** `MED-*` P0 fixtures pass, including EICAR, bombs and metadata. `INF-002`, `INF-003`. No public object before scan and moderation (`MED-037`). ClamAV signature freshness alert verified |
| **M6** Moderation and staff | State machine, AI verdicts, timers, queues, enforcement, appeals | All `MOD-*`, `CLS-*`, `AIF-*`, `CFG-*`, `TMR-*` P0. The failure-to-CLEAN property (`AIF-008`) with **zero** counter-examples. `E2E-002` to `E2E-005`, `E2E-008`. Prompt-injection canaries (`SEC-008`). Four-eyes on config and role grants (`CFG-004`, `AZ-015`). Keyboard path for the queue (`A11Y-004`). Hold expiry through the UI (`E2E-003`) |
| **M7** Trust, social, comparison | Trust score, votes maturity, notifications, comparison | `TRS-001` to `TRS-004`, `TRS-008`. Fake-review burst routing verified. Mandatory notifications cannot be disabled (`TRS-009`). Scope test that no messaging exists (`SCOPE-001`) |
| **M8** Hardening and launch | Pen test, ops, retention, privacy jobs | `OPS-*` P0. External pen test with **zero** open S1/S2 findings. Backup-restore test for proof deletion (`OPS-001`). Production build has no test hooks (`OPS-003`). Log-scrub verification in production config (`OPS-004`) |

**Standing rule for every milestone:** the full unit suite, the security checks and the accessibility component tests run
on every PR. A PR that changes a state, timer, permission or media rule must also update the matching catalogue rows
in the same PR.

---

## 7. Bug severity and reporting

Bugs are filed with the `bug.report` capability and carry the test ID that found them.

| Severity | Definition | Gate effect |
|---|---|---|
| **S1** | Security or privacy failure, data loss, violating content published, malware served, or any path to CLEAN after a failure | Blocks merge and the gate. Hotfix |
| **S2** | Functional failure of a P0 journey or a P0 test case that cannot be fixed in the milestone | Blocks the gate |
| **S3** | P1 defect, or P0 defect with a workaround | Ticket before the gate. Does not block |
| **S4** | Cosmetic, copy, or P2 issue | Backlog |

---

## 8. Test run policy

| Trigger | What runs | Expected time |
|---|---|---|
| PR (every push) | Unit, security checks, jest-axe, design tokens, integration subset for the changed area, E2E smoke (P0 only) | Under 20 min |
| Nightly on `main` | Full integration, full E2E, full media corpus, ClamAV signature freshness | Under 45 min |
| Milestone gate | Full catalogue for the milestone, manual keyboard and screen-reader spot checks, pen test in M8 | Per gate |

CI service containers are the M2 deliverable. Until then, integration and E2E tests run locally with
`pnpm infra:up`. The README states this.

---

## 9. Assumptions and ambiguities found while writing

These were found in the design docs while writing the cases. Each one has an assumed expected value so the test can
be written now. The Architect must confirm or correct them, and the catalogue is updated when they change.

1. **Milestone mapping M2–M8** is taken from `threat-model.md` §0. The repo does not define it.
2. **"24 h" and "7-day auto-reject"** are mapped to the post-review SLA (24 h, not an auto-action) and the **hold expiry**
   (7 days, auto-reject, `T7`). The post-review lapse at 144 h is a separate auto-close that leaves content live.
3. **Video duration tolerance.** `media-pipeline.md` §1 says "≤ 30 s, 0.5 s tolerance". Assumed: accept up to 30.5 s,
   reject above that. Cases `MED-017` cover 30.0, 30.4 and 31 s.
4. **"10 MB" and "50 MB"** are assumed to be 10 × 1024 × 1024 and 50 × 1024 × 1024 bytes. Config should state exact
   byte counts so the boundary cases are unambiguous.
5. **Failure reasons without an obvious enum value.** The enum has no POLYGLOT value, so a polyglot maps to
   `TYPE_MISMATCH`. Multiple video streams and a 4096 px+ video are assumed to map to `UNSUPPORTED_CODEC` and
   `TOO_MANY_PIXELS`. The Architect should confirm or add enum values. Only the REJECTED status is asserted until then.
6. **Declared versus real type.** The spec says types are verified by magic bytes. Assumed: a PNG named `.jpg` is
   accepted as PNG (the real type is allowed for photos), while an executable named `.jpg` is rejected.
7. **Hold versus revision.** Hold expiry is assumed to apply to edited revisions in the same way (`HELD → REJECTED`,
   `moderation-pipeline.md` §3.3).
8. **Appeal reviewer pool.** `T12` requires the reviewer to differ from the original decider. Small teams may have
   only one senior moderator. This is an operations risk, not a test gap, and it is raised here so ops can plan
   staffing.
9. **Dual-model planning.** The project asked for test planning with Gemini and authoring with Claude. Only the Claude
   authoring pass was run for this document. A Gemini planning review of the catalogue is **not** included and should
   be run before the M2 gate.
10. **No new dependencies were installed.** Playwright, jest-axe, @axe-core/playwright and exiftool are not yet in the
    repo. They are named here and land with M2 and M5.
11. **Report threshold versus threat F-9 (a conflict).** `moderation-pipeline.md` T11 hides live content when a report
    threshold is reached. `threat-model.md` F-9 says reports never auto-hide on count. Both cannot hold. Assumed: a
    count alone never hides content (`MOD-022`), and T11 hides only after an AI or staff re-assessment. The Architect
    must resolve this before the M6 gate.

---

## 10. Follow-up work (ordered)

1. **M2:** add integration harness (`*.int.test.ts`, `pnpm test:integration`), Playwright (`pnpm test:e2e`) and jest-axe;
   add CI service containers; add the test DB safety guard (`INF-005`); add the matrix data file and the ADR parity test
   (`AZ-001`).
2. **M2:** convert `docs/architecture/moderation-config.example.json` into a zod schema with the bounds in
   `moderation-pipeline.md` §5.4 (`CFG-001`, `CFG-005`).
3. **M5:** write the fixture generator in `test/fixtures/media/`, and add the ClamAV and exiftool steps to the worker
   test image.
4. **M6:** implement the `Clock` interface and the `FakeClock`, then the TMR and MOD tables. Decide the test-clock hook
   for E2E and add the production-absence check (`OPS-003`).
5. **Before M2 gate:** Architect confirms the §9 assumptions, and a Gemini planning review is run on the catalogue.
6. **Before M8:** pen-test scope written from the threat model, using the Critical and High rows in the catalogue.
