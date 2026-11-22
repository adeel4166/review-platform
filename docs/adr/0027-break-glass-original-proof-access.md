# ADR-0027: Break-glass `proof.view_original`: single-use streamed access with caps, a daily digest and a second approver for repeats

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-22 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #77 (M6–M8 spec) |
| **Related** | ADR-0003 (`proof.view_original`, SENIOR_MODERATOR, step-up, typed reason), ADR-0008, ADR-0022 · threat-model P-5, R-9 · m4-m5-spec §0.1 (deferred to M6), M45-Q12 · security review SEC-M4-08, SEC-M4-10 · [m6-m8-spec.md §9](../architecture/m6-m8-spec.md#9-break-glass-proofview_original-adr-0027) · catalogue `PRV-003` |

## Context

Since M4 nobody on staff can open a proof original; decisions use the redacted copy. Some cases need the original:
suspected forgery the redaction hides, a fully masked page (`REDACTION_FULL_MASK`), or a legal request. SEC-M4-10 asks
that no code path ever *presigns* an original key, because a presigned URL is a bearer token that can be forwarded,
cached or logged. `PRV-003` fixes the controls: `proof.view_original` + step-up + typed reason, every view audited, a
daily cap of 20 → deny + alert.

## Decision

1. **Grant:** `POST /api/admin/proofs/:proofId/files/:fileId/original-access` with `{reasonCode, reasonText}`.
   Requires `proof.view_original` (SENIOR_MODERATOR), step-up within 10 minutes, the COI guard (not the submitter, not
   a member of the product's seller), `reasonCode ∈ {SUSPECTED_FORGERY, REDACTION_UNUSABLE, LEGAL_REQUEST,
   APPEAL_REVIEW}` and `reasonText` of 20–500 characters. The original must still exist (`410 original_purged`
   otherwise: under the default `AT_DECISION` retention only undecided proofs have originals).
2. **Caps:** at most 20 grants per staff member per UTC day; the 10th triggers an alert; the 21st is refused
   (`429 break_glass_cap`) and alerts SECURITY. A second grant for proofs of the **same submitter** within 7 days
   needs a `BREAK_GLASS_REPEAT` approval (ADR-0026). Counting uses the `BreakGlassAccess` rows and the injected clock.
3. **Delivery:** the grant creates a `BreakGlassAccess` row (staff id, session id, proof/file ids, reason code and
   text, `expiresAt = now + 60 s`, `usedAt`). The browser then calls
   `GET /api/admin/break-glass/:accessId/content`, which checks the same session, marks `usedAt` with a conditional
   update (single use), and **streams** the bytes from the private bucket through the web app with
   `Cache-Control: no-store`, `Content-Disposition: inline`, `Content-Security-Policy: sandbox; default-src 'none'`,
   `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. No presigned URL for an original key is ever
   created. The only module allowed to read `proof/*/orig` is `apps/web/src/server/break-glass.ts` (static test
   replaces the SEC-M4-10 "never presigned" test with "read only here, never presigned").
4. **Audit:** one `proof.view_original` `AuditLog` row per grant and one `proof.view_original.served` row per stream
   (ids and reason code only; the free text stays on `BreakGlassAccess`, per lifecycle §6.1 rule 3). A daily digest
   (`maintenance.break-glass-digest`, 07:00 UTC) e-mails every SUPER_ADMIN the previous day's grants per staff member.
5. **Same pattern for redacted views (SEC-M4-08, cheap):** a per-staff limit of 200 `proof.view_redacted` per hour with
   an alert on breach.

## Alternatives considered

| Option | Why not |
|---|---|
| Presigned GET with a 60 s TTL | A bearer URL; leaks via browser history, proxies and screenshots of devtools; contradicts SEC-M4-10 |
| Keep originals inaccessible forever | Forgery review and legal requests would require ad-hoc database or bucket access, which is worse for P-5 |
| Hand the original to the `media` worker for an "unredacted preview" | Adds a second path to the same bytes and puts PII in job outputs |

## Consequences

**Positive:** originals are viewable only by an accountable person, once, for a stated reason, within a cap.

**Negative / risks:** the web app keeps read access to the private bucket (already true for redacted copies). With
`AT_DECISION` retention, break-glass helps only before the decision; that is intended (minimisation, C-4).

## Follow-ups

- Security: alert routing for the cap and the digest recipients list.
- QA: `PRV-003` (cap, step-up, reason, audit, single use, session binding) and the static read-path test.
