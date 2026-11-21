# ADR-0016: Email verification, mail-provider interface and generic registration response

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-21 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #44 (M3-01) |
| **Related** | [m3-sellers-spec.md §3](../architecture/m3-sellers-spec.md), m2-security-review SEC-05 (risk-accepted at M2, target M3), threat model A-2/A-9/O-2, ADR-0002, ADR-0007 §4, ADR-0009, open question T-2 |

## Context

`POST /api/auth/register` returns 409 "Email or handle already in use", which is an account-enumeration oracle
(SEC-05). The M2 review accepted the risk until email verification exists. M3 also needs email for business-email
claims, seller invitations and claim notifications. The platform sends no email today, and `User.emailVerifiedAt`
is never set.

## Decision

1. **Generic register.** The password is always hashed. A new email creates an unverified user and queues a
   verification email. A known email changes nothing and queues an "account exists" email (at most one per hour).
   Both return **202 `{"status":"verification_sent"}`** with identical body and headers, and no session. Handle
   conflicts may still return 409, because handles are public.
2. **Verification gate.** Sign-in is allowed while unverified. Content creation, seller creation, claim submission and
   invitation acceptance require `emailVerifiedAt`, read from the DB for each request.
3. **Tokens.** `EmailVerificationToken` (purposes `ACCOUNT_EMAIL`, `CLAIM_BUSINESS_EMAIL`) holds 256-bit tokens,
   stores only SHA-256, is single use, expires in 24 h and is bound to the target address. Claim tokens are bound to
   the claimant's session. GET never consumes a token: a confirm page POSTs, which is safe against mail-scanner
   prefetch.
4. **Worker-side generation.** The web app writes a token row without a hash plus an outbox event. The worker
   generates the raw token, stores its hash, then sends. Raw tokens never touch the DB, queues or logs.
5. **`MailProvider` interface** in `packages/core` with `SmtpMailProvider` (Mailpit in dev, SMTP relay in prod until
   T-2 is chosen) and `FakeMailProvider` (tests). Only the worker sends mail. There is no console provider. Links use
   `APP_URL`, never the request host.
6. **Mailpit** is added to `docker-compose.yml` for dev and E2E.
7. Unverified, contentless accounts are purged after 7 days. This frees squatted addresses (A-2).

## Alternatives considered

| Option | Why not |
|---|---|
| Keep 409 with rate limits (M2 state) | Still an oracle. The limits only slow harvesting |
| Verify before creating the account (pending-signup table) | Cleaner data, but a second identity table and harder handle reservation. The purge reaches the same result |
| Magic-link login instead of passwords | A product change beyond M3 |
| Send mail from the web request | Puts SMTP credentials in the web tier and makes response timing depend on the provider, which is an oracle again |
| Reuse the draft `VerificationToken` | The task asks for `EmailVerificationToken`. The claim binding (`claimId`, CHECK) and the "hash set at send" rule are email-specific |

## Consequences

**Positive:** Closes SEC-05. Gives one tested email path for claims, invitations and notifications.

**Negative / risks:** Existing tests and seeds must create verified users. The register UI no longer signs in
automatically. A one-hour cap on "account exists" emails is a small inbox-flooding vector (rate limited). Password
reset is still missing (M3-Q9).

## Follow-ups

- M3-03 implements this ADR. QA adopts AUT-014…AUT-017. DevOps chooses the production provider (T-2) with SPF, DKIM
  and DMARC.
