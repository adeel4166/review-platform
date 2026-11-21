# ADR-0019: 2FA, step-up and revocable sessions on the Auth.js baseline (amends ADR-0002)

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-21 |
| **Deciders** | Software Architect (author). CEO (approval). Security (review in M3b-10) |
| **Task** | #54 (M3b-03) |
| **Related** | ADR-0002 §1, §3, §4, §5; ADR-0003 guard 3; [m3b-spec.md §2](../architecture/m3b-spec.md#2-two-factor-authentication-adr-0002-3-adr-0019); threat model A-1, A-3…A-8, A-14; m3-sellers-spec §4.5 (interim step-up, never implemented) |

## Context

ADR-0002 chose first-party, server-side sessions and rejected Auth.js. The scaffold nevertheless shipped
**Auth.js v5 with `strategy: "jwt"`** and a Credentials provider. `refreshJwt()` re-reads the user on every request,
so bans and role changes apply at once, but there is no session row. Without one we cannot:

- mark a session as "password OK, second factor pending" and keep it away from every other route (A-5);
- count failed codes per session and kill the session on the 5th (A-1);
- record step-up time (ADR-0002 §4) or revoke one session (logout, "sign out others", 2FA change);
- rotate the session identifier on 2FA completion (A-4).

Also, ADR-0002 stores recovery codes as bare SHA-256. Threat A-7 asks for HMAC with a server key or Argon2id, so a
database leak cannot be brute-forced offline at 2^50.

M3b needs 2FA now: ownership transfer requires it for both parties (ADR-0017), and seller OWNER/MANAGER permissions
require it (ADR-0003).

## Decision

1. **Keep Auth.js as the cookie/JWT carrier and add a `UserSession` row per session.** The JWT holds
   `{sub, sid, sv}`. `refreshJwt()` loads the row by primary key on every request and signs out on: missing row,
   revoked row, expired idle/absolute lifetime, expired pending window, user not ACTIVE, `sv` mismatch. Lifetimes from
   ADR-0002 (staff 2 h / 12 h, users 30 d / 90 d) are enforced on the row. The `jwt` callback **never** reads its
   `session` argument (client-controllable through `update()`).
2. **Pending-2FA is default-deny by construction.** For a pending row the `session` callback returns no `user.id`,
   so every existing guard sees an anonymous request. One function, `requirePendingSession()`, reads pending
   sessions. It is imported only by the two verify routes, and a CI test enforces that.
3. **Rotation by successor pointer.** Completing 2FA (or enrolling) creates a successor row and revokes the old one.
   The `jwt` callback swaps `sid` to the successor once (conditional update), within 60 s.
4. **TOTP:** RFC 6238, SHA-1, 6 digits, 30 s, ±1 step. 160-bit secret, AES-256-GCM with
   AAD = `totp|userId|rowId` and a `keyId` for rotation. Replay is blocked by a conditional `lastUsedStep` update.
   Enrolment requires step-up and is enabled only after a valid code.
5. **Recovery codes:** 10 × 60-bit codes, stored as **HMAC-SHA-256 with a pepper from the secret manager** (with
   `keyId`). They share every attempt limiter with TOTP. Staff use forces re-enrolment and alerts the security channel.
6. **Attempt caps:** 5 failures per pending session (then the session is revoked), 10 per account per 15 min across
   sessions, 30 per IP per 15 min. The limiter fails closed. No hard lock-out (ADR-0002 §5 unchanged).
7. **Gates:** the ADR-0003 2FA gate is enforced for staff permissions and for seller permissions exercised through
   OWNER/MANAGER, from M3b. There is no feature flag. The M3a interim control (m3-sellers-spec §4.5) is dropped.

This amends ADR-0002 §1 (session storage mechanism: JWT carrier + DB row instead of an opaque cookie token), §3
(recovery-code hashing) and §5 (2FA attempt caps). Everything else in ADR-0002 stands.

## Alternatives considered

| Option | Why not |
|---|---|
| Replace Auth.js with the ADR-0002 opaque-token sessions now | Correct, but it rewrites sign-in, the session reader in every route and the T-02 fix just before launch. The row gives the same properties (revocation, pending, step-up, rotation) with a smaller change. Can still be done later behind the same `requireUser()` API |
| Auth.js `strategy: "database"` | Auth.js does not support database sessions with the Credentials provider. It would also impose the adapter's table shapes |
| Pending flag and counters inside the JWT only | No revocation, and the per-session counter resets whenever an old JWT is replayed. Fails A-1 and A-5 |
| Argon2id for recovery codes | Checking up to 10 codes at ~250 ms each per attempt is a CPU DoS lever (A-11). HMAC with a secret pepper meets A-7 |
| Feature-flagged staff gate (on in M8) | Leaves staff without 2FA for longer, and a flag is one more bypass. Dev seeds can enrol staff instead |

## Consequences

**Positive:** immediate revocation per session, a real pending gate, step-up and rotation. Staff 2FA (part of
SEC-09(d)) lands early. Recovery codes survive a database leak.

**Negative / risks:** one more primary-key read per request. Two new secrets to manage (`TOTP_ENC_KEYS`,
`RECOVERY_CODE_PEPPERS`) and to keep out of the egress group and out of database backups. Deploying invalidates all
current JWTs (acceptable pre-launch). The Auth.js cookie name may differ from the `__Host-` name ADR-0002 assumed
(M3b-Q15).

## Follow-ups

- M3b-04 implements it. M3b-10 reviews it against A-1, A-3…A-8, A-14.
- OPS-002 key-rotation drill covers both secrets. The staff 2FA reset runbook (two staff) stays until AZ-024 (M6).
- Revisit replacing Auth.js entirely when Google sign-in (OIDC) is built.
