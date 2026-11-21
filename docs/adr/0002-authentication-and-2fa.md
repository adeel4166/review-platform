# ADR-0002: Authentication, sessions and two-factor authentication

| | |
|---|---|
| **Status** | Accepted (merged to `main` with CEO approval, proposal #8) |
| **Date** | 2026-11-20 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #18 (M1.1) |
| **Related** | ADR-0001 (stack), ADR-0003 (permissions), [data-model.md §3.1](../architecture/data-model.md#31-identity--access) |

## Context

Requirements that shape authentication:

1. **Enforcement must take effect immediately.** When a moderator bans or suspends an account, that user's write access has to stop on their next request, not when a token expires.
2. **Staff and seller accounts are high-value targets.** A compromised moderator account can remove legitimate content. A compromised seller account can publish replies in the brand's name. These accounts need 2FA.
3. **Sensitive operations need recent proof of presence.** Examples: viewing unredacted purchase proofs, granting roles, disabling 2FA, changing email.
4. **The auth surface is small.** Phase 1 needs email + password, Google sign-in and TOTP 2FA. There is no enterprise SSO and no SAML.
5. **Every security-relevant event must be auditable** in our own `AuditLog`.
6. **Personal data must stay under our control.** The legal position is still open (L-1, L-6), so we should not commit early to a third-party identity store.

## Decision

### 1. First-party, server-side sessions (no JWT sessions)

- On login we create a `Session` row. The browser gets a cookie containing a **random 256-bit token** (base64url). Cookie settings:
  `__Host-sid`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`.
- **Only `SHA-256(token)` is stored** (`Session.tokenHash`). A leaked database cannot be replayed as cookies.
- Lifetimes:

  | Account type | Idle timeout | Absolute timeout |
  |---|---|---|
  | Users | 30 days (sliding) | 90 days |
  | Accounts with any `PlatformRole` | 2 hours | 12 hours |

  To keep write load down, `lastActiveAt` / `idleExpiresAt` are refreshed at most once every 5 minutes.
- **Revocation** sets `revokedAt` and `revokeReason`. This happens automatically on: logout; password reset or change (all sessions); 2FA disable or enable (all other sessions); role grant or revoke (all sessions of the target user); `SUSPENSION` / `BAN` enforcement (all sessions); and the user's "sign out everywhere".
- **Rotation:** a new token is issued, and the old session revoked, on login, on privilege change and on completing 2FA. This prevents session fixation.
- The request-time lookup is one indexed primary-key query. If profiling shows it is needed, a short (≤ 30 s) Redis cache may sit in front of it, and revocation must invalidate that cache entry.

### 2. Credentials

- **Passwords:** Argon2id, using a maintained native binding with OWASP-recommended parameters (minimum m = 19 MiB, t = 2, p = 1; tune so hashing takes about 250 ms on production hardware). Minimum length 10 with no composition rules. Passwords are checked against a breached-password k-anonymity API, and the check fails open (logged) if the API is down.
- **Email verification** is required before a user can create content, vote, report or follow. Tokens are single-use. `VerificationToken` stores only the hash, and tokens expire after 24 h (verification) or 30 min (password reset).
- **Google sign-in (OIDC)** uses a small, maintained OAuth client library with PKCE and state/nonce. We store only `provider` + `sub` in `OAuthAccount`, and no provider tokens.
  - **Linking rule (prevents pre-account takeover):** a Google identity is linked to an existing account only if Google reports the email as verified **and** the user proves control of the existing account (password login or emailed link). We never link silently on email match.
- **Apple sign-in** is deferred (T-6). The enum value is reserved.

### 3. Two-factor authentication

| Factor | Phase 1 | Notes |
|---|---|---|
| **TOTP** (RFC 6238, 6 digits, 30 s, ±1 step) | Yes | The secret is encrypted with AES-256-GCM using an application key from the secret manager. `keyId` is stored for rotation. `lastUsedStep` rejects code replay |
| **Recovery codes** | Yes | 10 codes of ≥ 50 bits each, shown once and stored as SHA-256 hashes. Using one triggers a `SECURITY_ALERT` notification |
| **Passkeys / WebAuthn** | Stretch | `WebAuthnCredential` table reserved. Recommended for staff when it ships |
| **SMS / email OTP as a second factor** | No | Vulnerable to SIM swap, has a cost, and email is already the recovery channel |

**When 2FA is mandatory:**

- Holders of any `PlatformRole` (MODERATOR, SENIOR_MODERATOR, ADMIN, SUPER_ADMIN). A role grant is stored, but **it stays inactive until 2FA is enrolled** (enforced by the authorization layer, ADR-0003). Staff sessions must have `secondFactorVerifiedAt` set.
- Seller members with role `OWNER` or `MANAGER`. Seller-scoped permissions are inactive until 2FA is enrolled.
- Optional, but encouraged, for everyone else.

**Login flow with 2FA:** after a correct password, the session is created with `secondFactorPending = true` and a 10-minute absolute expiry. While pending, it can only call the 2FA-verify endpoint. A correct code rotates the session to a normal one with `secondFactorVerifiedAt` set.

### 4. Step-up (re-authentication)

These actions require `Session.reauthenticatedAt` within the last **10 minutes**. The user re-proves their password (or OAuth login) **and** their TOTP code if 2FA is enabled:

- Change email or password, disable 2FA, regenerate recovery codes, delete the account.
- Grant or revoke a `PlatformRole`, add or remove a seller `OWNER`, transfer seller ownership.
- `proof.view_original` (break-glass view of an unredacted purchase proof), and setting or releasing a legal hold.
- Issuing a `BAN` or `SELLER_SUSPENSION`.

### 5. Abuse protection

- Rate limiting in Redis (sliding window) on login, 2FA verify, password reset, sign-up and resend-verification. Limits apply per IP and per account identifier. Repeated failures add progressive delay, and a CAPTCHA appears after the threshold. There is no hard lock-out, because lock-outs can be used to lock other people out.
- The same response is returned for "unknown email" and "wrong password", and password-reset requests always show the same message (no account enumeration).
- Every authentication event (login success or failure, 2FA change, session revoke, password change) writes an `AuditLog` row with `ipHash` and `userAgent`. Users get a `SECURITY_ALERT` notification for new-device logins and credential changes.

### 6. CSRF and transport

- Server Actions rely on Next.js' built-in Origin/Host check together with `SameSite=Lax`. Mutating Route Handlers verify `Origin` explicitly. GET requests never mutate.
- HSTS (preload-eligible), a strict CSP and `frame-ancestors 'none'` are configured at the scaffold step.

## Alternatives considered

| Option | Assessment |
|---|---|
| **Auth.js (NextAuth)** | Popular, but the credentials provider is designed around JWT sessions (in conflict with immediate revocation, requirement 1), and there is no first-class TOTP 2FA, so we would still write most of the security-critical parts ourselves. Rejected |
| **Better Auth** (TypeScript library with DB sessions, 2FA/passkey/organisation plugins) | The closest functional fit, and a credible fallback. Not chosen because it owns the shapes of identity tables that are central to our enforcement, audit and seller-membership design, and its organisation model would overlap with `SellerMember`. **Revisit** if maintaining our own auth turns out to be costly in M2 |
| **Hosted identity provider (Clerk, Auth0, Cognito, …)** | Strong security posture and less code. However: per-MAU cost on a consumer product, personal data held by a third party while L-1/L-6 are open, enforcement and revocation become a sync problem between two systems, and staff 2FA policies get split across systems. Rejected for Phase 1 |
| **Stateless JWT access + refresh tokens** | Revocation needs a denylist anyway, which leaves us with a stateful session plus extra complexity. Rejected |
| **Hand-rolled cryptography** | Never. We only use maintained libraries for Argon2id, TOTP, OAuth/OIDC and WebAuthn. "First-party" here means we own the session and data model, not the cryptographic primitives |

## Consequences

**Positive:** bans and revocations take effect immediately. Our own schema integrates with enforcement, audit and seller roles. Step-up is cheap because it is one column on the session. There is no per-user vendor cost.

**Negative:** the auth code is ours to maintain and must be covered by the threat model (M1) and a security review before launch. A DB lookup on every request; this is acceptable, and caching is possible. The TOTP encryption key needs secret-manager management and a rotation procedure (`keyId`).

## Follow-ups

- Threat model (M1): session theft, OAuth linking, 2FA bypass, recovery-code abuse, staff account takeover.
- Scaffold: choose the specific libraries (Argon2id binding, OIDC client, TOTP) and record them in the scaffold PR. Configure cookie and security headers.
- Ops runbook: staff 2FA reset requires two people (SUPER_ADMIN plus another ADMIN) and is audited.
