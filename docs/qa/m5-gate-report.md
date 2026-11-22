# M5 QA gate report

| | |
|---|---|
| **Owner** | QA Engineer (QA_SECURITY) |
| **Task** | #76 on branch `task/76`, main at `9ab454c` (includes #74 media UI, #75 fix pack) |
| **Scope** | [test-strategy.md](./test-strategy.md) §6 line 232: all `MED-*` P0 (EICAR, bombs, metadata), `INF-002`, `INF-003`, `MED-037`, ClamAV signature-freshness alert. Case list: [m4-m5-spec.md](../architecture/m4-m5-spec.md) §13.2, §13.7 |
| **Rule** | PASS = zero open P0 defects **and** all P0 cases asserted by named tests |

## Verdict

**FAIL.** The gate items named in the task pass: EICAR (MED-012/013/014), decompression bomb (MED-006), metadata stripping (MED-001/002/003/021/039/042), MED-037, INF-003 and the freshness alert (INF-007). But **7 P0 cases have no implementation or no named test** (QA-M5-01..07, below), so the rule is not met. Production source was not changed (QA manifest); this run added `apps/worker/src/m5-gate.test.ts` (7 tests).

## 1. Evidence

| Layer | Command | Result |
|---|---|---|
| Full QA script | `pnpm qa` (lint, typecheck, test, design:check) | **exit 0** |
| M5 gate tests | `pnpm --filter @rp/worker exec vitest run src/m5-gate.test.ts src/media-pipeline.test.ts src/media-publish.test.ts src/media-exif.test.ts` | pass |
| clamd | in-process fake clamd speaking the real `zVERSION` / `zINSTREAM` wire protocol | used; real `clamav/clamav:1.4` image **NOT RUN** (CI `docker compose --profile media`, not wired; QA-M5-11) |
| MinIO runtime (`scripts/inf002-bucket-check.sh`) | needs `mc` + MinIO | **NOT RUN** (no CI job; QA-M5-11) |
| ffmpeg video cases | skipped when `ffmpeg` is absent (`hasFfmpeg`) | see run output; CI `qa` job image must have ffmpeg |

`DATABASE_URL` is the throwaway CI placeholder. No secret was read.

## 2. Per-case results (P0 unless noted)

**PASS** = named test asserts the case. **PARTIAL** = part asserted, rest listed. **GAP** = not implemented or not asserted (counts against the gate).

| ID | Result | Evidence or gap |
|---|---|---|
| MED-001, 002, 003 | **PASS** | `media-pipeline.test.ts` "MED-001/002 ...", "MED-003 ..." (no EXIF/XMP/IPTC/ICC in variants; Orientation applied first) |
| MED-039 | **PASS** | `media-exif.test.ts:47` |
| MED-042 | **PASS** | "MED-042: a variant that still carries metadata ... -> FAILED PROCESSING_ERROR + alert" |
| MED-005 | **PASS** | "MED-005: exactly 10 MiB accepted; one byte more -> TOO_LARGE" |
| MED-006 | **PASS** | "MED-006: image bomb (64 MP) -> TOO_MANY_PIXELS". Memory-limit part not asserted (no sandbox, QA-M5-01) |
| MED-007 | **PASS** | "MED-007: polyglot jpegPlusZip/Pdf/Svg/Pe -> TYPE_MISMATCH" |
| MED-008 | **PARTIAL** | Executable named .jpg -> `UNSUPPORTED_TYPE` passes. Spec: a PNG declared as JPEG is `READY` as `image/png`; code returns `TYPE_MISMATCH` (`media.ts:93`). Stricter than spec, safe; **QA-M5-10** (P2, spec owner decides) |
| MED-009, 010 | **PASS** | "MED-009/010/022: gif, svg, exe, zip, webm declared as JPEG -> UNSUPPORTED_TYPE" (BMP and TIFF not in the fixture list, same code path) |
| MED-012 | **PARTIAL** | New "MED-012: EICAR named .jpg -> REJECTED MALWARE, quarantined, ingest deleted, nothing public" and the existing alert and scan-log assertions pass. **Not implemented:** `TrustSignal MALWARE_UPLOAD`, parent forced to UNSURE, `MEDIA_REJECTED` notice to uploader (**QA-M5-08**) |
| MED-013 | **PASS** (new) | 40 MB stream with EICAR at 30 MB is flagged over zINSTREAM; `infra/clamav/clamd.conf` `StreamMaxLength`, `MaxFileSize`, `PCREMaxFileSize` = 64M |
| MED-014 | **PARTIAL** | Fail-closed asserted (throws, stays PROCESSING, nothing written). Retry schedule differs: media queue is `attempts: 3`, 5 s exponential (`core-main.ts:32`) vs spec 1 m ... 1 h x 4 (about 6 h) (**QA-M5-09**) |
| MED-015 | **PASS** (new) | "MED-015: one scanner error then clean -> READY with virusScannedAt" |
| MED-016 | **PASS** | "MED-016: banned hash -> BANNED_HASH before the scanner runs" |
| MED-017 | **PASS** | "MED-017: 30 s passes, 31 s -> TOO_LONG" (needs ffmpeg) |
| MED-018 | **PASS** (new) | 50 MiB cap constant and "+1 byte -> TOO_LARGE" |
| MED-021 | **PASS** | "MED-021: video with location/title metadata -> READY, H.264 720p MP4 + poster, metadata gone" (needs ffmpeg). HEVC/HDR/rotation iPhone MOV fixture not present |
| MED-024 | **GAP** | PDF evidence is unsupported: `detectType` has no PDF (`media.ts:91`, `validate.ts:11`). Needed for MED-024/046 (**QA-M5-05**) |
| MED-025 | **GAP** | Only `content-length` is signed. `content-type` is not (`packages/core/src/media-presign.test.ts:16`, `packages/core/src/media.ts:105`) (**QA-M5-06**) |
| MED-026 | **NOT RUN** | 24 h ingest lifecycle is checked by `scripts/t08-minio-check.sh`, CI job `t08-minio`. `NOT_CONFIRMED` on a missing object passes in "MED-040" |
| MED-027 | **PASS** | "MED-040 ... 1 byte short -> TYPE_MISMATCH"; web "404s for another user", "moves to PROCESSING ... without calling HEAD/GET" |
| MED-028 | **GAP** | No named test that the ingest key cannot be overwritten after confirm, or that promote copies the derivative (sha256 equals output). Promote-copy is exercised in `media-publish.test.ts` but sha256 equality is not asserted (**QA-M5-12**) |
| MED-029 | **PASS** | `media-publish.test.ts` "MED-029 / MED-045: demote" (origin deleted first, flags cleared, CDN purged, `DEMOTE_FAILED` alert) |
| MED-030 | **GAP** | `processModeration` does not look at media state: no wait, no `MEDIA_TIMEOUT` (`apps/worker/src/moderation.ts:80`) (**QA-M5-04**) |
| MED-031 | **PARTIAL** | Constants 10 photos / 2 videos pinned (new); web "409s at 10 photos"; 2-video cap in "allows a video up to 50 MiB ... caps videos at 2". **Not asserted:** refusal at review submit |
| MED-034 | **PARTIAL** | `PUBLIC_HEADERS` (cache, inline, no file name) asserted in `media-publish.test.ts`. `nosniff` and `CSP: sandbox` rely on `infra/cdn/media-headers.json`, which **does not exist** (**QA-M5-12**) |
| MED-035 | **GAP** | No bwrap/no-network sandbox and no 200-file malformed corpus. `video.ts:55` defers sandboxing to deployment (**QA-M5-01**) |
| MED-036 | **GAP** | No `HashMatcher` hook; only exact sha256 `BannedMediaHash` lookup (`media.ts:99`) (**QA-M5-02**) |
| MED-037 | **PASS** | `media-publish.test.ts` "MED-037 / MED-044: promotion only after scan + sanitise + approved moderation" and "MED-037: the DB CHECK rejects a raw update that makes an asset public without scan or moderation clearance" (CHECK `chk_media_public_bucket`, migration `20261220000000_media_pipeline`). CHECK rejection on live MySQL **NOT RUN** (CI-only) |
| MED-038 | **PASS** (new) | Static pin: no `fetch`/HTTP client in media routes or `server/media.ts`, no URL field in the slot contract |
| MED-040, 041 | **PASS** | "MED-040 ...", "MED-041: signatures older than 72 h -> scanner unavailable (retry); 25 h -> scan proceeds with a CLAMAV_STALE alert" |
| MED-043 | **GAP** | No staging sha256 compare, no `STAGING_HASH_MISMATCH` alert (grep: none). The pipeline reads ingest once, which narrows the TOCTOU, but the case asserts the check (`media.ts:82`) (**QA-M5-03**) |
| MED-044, 045 | **PASS** | `media-publish.test.ts` |
| MED-046 | **GAP** | Same as MED-024 (**QA-M5-05**) |
| MED-047 | **GAP** | No startup self-test or `MEDIA_SANDBOX_REQUIRED` (**QA-M5-01**) |
| INF-002 | **PARTIAL** / **NOT RUN** | New static pin: `rp-web.json` grants no read on `rp-ingest`; INF-006 static test passes. Runtime check `scripts/inf002-bucket-check.sh` is **NOT RUN** and no CI job runs it (**QA-M5-11**) |
| INF-003 | **PASS** | zVERSION parsed, engine and signature version logged on every `VIRUS_SCAN` row, > 24 h stale warns, > 72 h refuses to scan |
| ClamAV freshness alert (INF-007) | **PASS** | "INF-007: /healthz 200 when fresh; 503 clamav_stale at 25 h with one alert per 6 h; 503 clamav_unreachable when clamd is down" |
| INF-006 | **PASS** | `apps/web/src/server/inf006-static.test.ts` |
| INF-008 | **GAP** | `groups.ts:9` forbids DB, SMTP, auth and TOTP variables only (no AI key), and `groups.test.ts` has no media-group assertion (**QA-M5-07**) |
| MED-011, 019, 020, 022, 023, 032, 048, 049, INF-004 | P1 | MED-019, 022 (webm), 023 pass by name. MED-032 retention, MED-048 (HEIC flag), MED-049 (media wait), INF-004 (worker image: `infra/worker/` does not exist) not asserted. Tickets, not gate-blocking |

### Totals
P0 gate items asked for: **EICAR PASS, bombs PASS, metadata PASS, MED-037 PASS, INF-003 PASS, freshness alert PASS, INF-002 PARTIAL (runtime NOT RUN), INF-003 PASS.** All-MED-P0 rule: **7 defects open (all P0)**.

## 3. Defects

No tracker access from this sandbox; the platform should file these.

| ID | Sev | Cases | File:line | Summary |
|---|---|---|---|---|
| QA-M5-01 | **P0 (S1-class)** | MED-035, MED-047, U-1, PRV-023 (OCR) | `apps/worker/src/media/video.ts:55`, `apps/worker/src/media.ts:82` | No parser sandbox. libvips runs in the worker process and ffmpeg is spawned unsandboxed; sandboxing is left to deployment. No startup self-test, no malformed corpus |
| QA-M5-02 | **P0** | MED-036 | `apps/worker/src/media.ts:99` | No hash-matching hook (`HashMatcher.check({sha256, pHash})`, pHash, legal hold on match). Only an exact sha256 `BannedMediaHash` lookup exists |
| QA-M5-03 | **P0** | MED-043 | `apps/worker/src/media.ts:82` | No staging sha256 comparison and no `STAGING_HASH_MISMATCH` alert |
| QA-M5-04 | **P0** | MED-030, MED-049 | `apps/worker/src/moderation.ts:80` | Moderation does not wait for media: no re-delay while PROCESSING, no `MEDIA_TIMEOUT` verdict at 30 min, no detach of rejected media before assessing text |
| QA-M5-05 | **P0** | MED-024, MED-046 | `apps/worker/src/media.ts:91`, `apps/worker/src/media/validate.ts:11` | PDF evidence not supported: no type detection, no 20-page limit, no encrypted-PDF `CORRUPT`, no page rasterise |
| QA-M5-06 | **P0** | MED-025 | `packages/core/src/media.ts:105` | Presigned PUT signs `content-length` only; `content-type` is unsigned, so storage cannot refuse a different type. Spec §6.3 requires both. The existing test comment records this as known (`media-presign.test.ts:16`) |
| QA-M5-07 | **P0** | INF-008 | `apps/worker/src/groups.ts:9` | Media-group environment assertion lacks AI keys and has no test that startup exits 1 |
| QA-M5-08 | P1 | MED-012 (P0 side effects) | `apps/worker/src/media.ts:155` | On MALWARE: no `TrustSignal MALWARE_UPLOAD`, no forcing of the parent review to at least UNSURE, no `MEDIA_REJECTED` uploader notice. Only an alert and the quarantine copy. Raise to P0 if the spec owner treats these as part of MED-012 (the catalogue does) |
| QA-M5-09 | P1 | MED-014 | `apps/worker/src/core-main.ts:32` | Media queue retries 3 times with 5 s exponential backoff, not 1 m / 5 m / 15 m / 30 m / 1 h x 4 over about 6 h. A 15 s clamd restart can exhaust retries and fail an upload |
| QA-M5-10 | P2 | MED-008 | `apps/worker/src/media.ts:93` | PNG declared as `image/jpeg` is `TYPE_MISMATCH`; spec says `READY` as `image/png` |
| QA-M5-11 | P1 | INF-002, MED-013 (real clamd), live-DB cases | `.github/workflows/ci.yml:146` | No CI job runs `scripts/inf002-bucket-check.sh`, the `clamav` compose profile, or live-MySQL vitest (VOT-003, RPT-004, PRV-017, MED-037 CHECK). The cases exist but never run against real services |
| QA-M5-12 | P1 (P0 cases) | MED-034, MED-028 | `apps/worker/src/media/publish.ts:56` | `infra/cdn/media-headers.json` (nosniff, CSP sandbox) does not exist; no test that promote copies the derivative with a matching sha256 or that ingest keys cannot be overwritten |

Verdict rule: QA-M5-01..07 are P0 and open, so **FAIL**. QA-M5-08 and QA-M5-12 concern P0 cases and need a decision.

## 4. NOT RUN items and the CI job that should cover them

| Item | CI job today | Gap |
|---|---|---|
| Real ClamAV (`clamav/clamav:1.4`) EICAR and 30 MB case | none | add to `e2e` or a `media` job (QA-M5-11) |
| `inf002-bucket-check.sh` (anonymous 403, web has no GET on ingest) | none | add next to `t08-minio` |
| 24 h ingest lifecycle, signed content-length, CORS (MED-026, MED-025 part) | `t08-minio` (`ci.yml:146`) | covered |
| ffmpeg cases (MED-017/019/021) | `qa` (skip when binary is missing) | confirm ffmpeg is in the runner |
| `chk_media_public_bucket` raw SQL rejection (MED-037) | none | live MySQL job |
| E2E media upload UI | `e2e` (`ci.yml:58`) | covered |
| Worker image pins (INF-004, P1) | none | `infra/worker/Dockerfile` missing |

## 5. Required to reach PASS

1. Implement and test QA-M5-01..07 (sandbox and self-test, hash matcher, staging hash check, media wait in moderation, PDF evidence, signed content-type, media-group env assertion).
2. Decide QA-M5-08 and QA-M5-12 (add MALWARE side effects, add `infra/cdn/media-headers.json` and a test).
3. Add the CI jobs in §4 and re-run this gate.

## Reproduce

```bash
export DATABASE_URL=mysql://app:app@127.0.0.1:3306/ci   # throwaway CI placeholder
pnpm qa
pnpm --filter @rp/worker exec vitest run src/m5-gate.test.ts src/media-pipeline.test.ts src/media-publish.test.ts src/media-exif.test.ts
```

## History

- **task #76 (this report):** FAIL. 7 P0 defects open, 7 gate tests added.
- **task #84 (CLOSE-02):** QA-M5-01..07 and SEC-M5-01/02/03 closed by code and named tests in `apps/worker/src/close02.test.ts` (MED-035/036/043/047/024/046, INF-008, SEC-M5-02/03), `packages/core/src/media-presign.test.ts` (MED-025), and `apps/worker/src/moderation/assess.int.test.ts` (MED-030, MED-012 parent UNSURE; BANNED_HASH now counts like MALWARE). Real bwrap isolation is **NOT RUN** here (bwrap is not installed in this sandbox); the wrapper argv, self-test and fail-closed paths are asserted with injected runners. Re-run the gate to flip the verdict.

---

## Re-gate (task #88, FINAL GATE, after CLOSE-02 / M8)

| | |
|---|---|
| **Evidence run** | `pnpm qa` exit 0 (core 594, web 854 + 1 todo, worker 326 pass / 6 skipped = `mysql-schema.int`); `pnpm --filter @rp/web build` exit 0; `node scripts/ops003-no-test-hooks.mjs apps/web/.next` ok. `DATABASE_URL` = CI placeholder |
| **it.fails** | `grep -rn "\.fails"` over apps, packages, test: **zero**. The two hits for "it.fails" text earlier were prose only. Converted and passing |

**Verdict: FAIL (2 P0 cases still without a named assertion).**

| Prior defect | Status | Named test |
|---|---|---|
| QA-M5-01 (MED-035, MED-047) | CLOSED | `close02.test.ts:56-137` |
| QA-M5-02 (MED-036) | CLOSED | `close02.test.ts:150` |
| QA-M5-03 (MED-043) | CLOSED | `close02.test.ts:175` |
| QA-M5-04 (MED-030) | CLOSED in code; test is `assess.int.test.ts:39` (MySQL, **not run locally**, see CI `mysql-int`) | |
| QA-M5-05 (MED-024/046) | CLOSED | `close02.test.ts:194-233` |
| QA-M5-06 (MED-025) | CLOSED | `media-presign.test.ts:26` |
| QA-M5-07 (INF-008) | CLOSED | `close02.test.ts:256-266` |
| QA-M5-08 / QA-M7-02 (MALWARE_UPLOAD) | CLOSED in code (`media.ts:34`) |  |
| **QA-M5-12 (MED-034, MED-028)** | **OPEN, P0 cases** | MED-034: `nosniff` and `CSP: sandbox` still exist only as a comment, `apps/worker/src/media/publish.ts:51`; `infra/cdn/media-headers.json` still does not exist. MED-028: no test that promote copies the derivative with equal sha256 or that an ingest key cannot be overwritten (`media-publish.test.ts:42` asserts headers and DB flip only) |
| QA-M5-11 (INF-002 runtime, real clamd) | PARTIAL | `scripts/inf002-bucket-check.sh` and the `clamav` profile still have no CI job (`.github/workflows/ci.yml`) |
| QA-M5-09, QA-M5-10 | P1/P2, not gating | not re-verified |
