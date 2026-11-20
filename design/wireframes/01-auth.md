# 01 · Sign-in, sign-up, 2FA

Source: ADR-0002 (Argon2id, Google OIDC, TOTP, recovery codes, 10-min pending session, step-up), threat model (enumeration, brute force).

## 1.1 Sign-in `/sign-in`
```
 Mobile / Desktop (centered card, max 28rem)
┌──────────────────────────────┐
│ Logo                         │
│ <h1>Sign in</h1>             │
│ [ G  Continue with Google ]  │
│ ───────── or ─────────       │
│ Email          [___________] │
│ Password       [___________] [Show]
│ [ ] Keep me signed in        │
│ [        Sign in         ]   │
│ Forgot password?             │
│ New here? Create account     │
└──────────────────────────────┘
```
- **States:** default · field error (`⚠ Enter a valid email`, `aria-describedby`) · invalid credentials (single generic alert: "Email or password is incorrect") · throttled ("Too many attempts. Try again in {mm:ss} or reset your password") · locked/banned (generic + support link) · unverified email (resend link) · loading (button `aria-busy`, stays enabled-look).
- **A11y:** `autocomplete="username"`/`current-password`; Show is a toggle button with `aria-pressed`; paste allowed (password managers); error summary focused on submit failure.

## 1.2 Sign-up `/sign-up`
Fields: Email, Display name, Password (with strength meter as text: "Strong / Too common"; min length per ADR, no composition rules), [ ] Accept Terms & Privacy (links; legal text OPEN), CAPTCHA/abuse challenge only after risk signal (accessible alternative required). Success → "Check your email" page (resend with cooldown). Same response whether or not the email exists.

## 1.3 Two-factor verification `/sign-in/2fa` (session `secondFactorPending`, 10-min expiry)
```
┌──────────────────────────────┐
│ <h1>Two-step verification</h1>│
│ Enter the 6-digit code from  │
│ your authenticator app.      │
│ Code  [_ _ _ _ _ _]  (single input, inputmode=numeric,
│                       autocomplete=one-time-code)
│ [        Verify        ]     │
│ Use a recovery code instead  │
│ ⏱ This step expires in {m}:{s}│  (announced at 2 min / 30 s only, role=timer, not live every second)
│ Cancel and sign in again     │
└──────────────────────────────┘
```
- **States:** wrong code (`⚠ That code didn't work. Codes refresh every 30 seconds.`) · replayed code (same message) · throttled · expired (redirect to 1.1 with notice) · recovery-code mode (single text input, hint "10 characters", warns that code is single-use; success shows `SECURITY_ALERT` notice "A recovery code was used. {n} left").
- **A11y:** one input, not six boxes (screen reader/paste friendly); focus lands on the code field; no auto-submit that surprises SR users (submit on button, optional on 6th digit with announced result).

## 1.4 2FA enrollment `/account/security/2fa/setup` (forced for staff and seller OWNER/MANAGER before roles activate)
Steps (progress as ordered list, `aria-current=step`): **1 Scan** (QR + "Can't scan? Enter this key" with copy button, key grouped in 4s) → **2 Confirm** (enter code) → **3 Save recovery codes** (10 codes shown once, [Download .txt] [Copy] [Print], required checkbox "I saved these" before Finish). Banner for role holders: "Your {Moderator} access is inactive until you finish this."

## 1.5 Step-up dialog (re-auth ≤10 min)
Modal: "Confirm it's you to {action}" → password (or Google re-auth) + TOTP code if enrolled → [Confirm] [Cancel]. Focus trapped, returns to trigger on close, `aria-describedby` names the action (e.g. "Ban user @x"). Used by: change email/password, disable 2FA, grant roles, ban, view original proof.

## 1.6 Account recovery `/forgot-password`, `/reset-password`
Email field → always "If an account exists, we sent a link". Reset form: new password + confirm; success signs out other sessions and shows notice.
