# Runbook: TOTP key rotation drill (OPS-002)

Keys: `TOTP_ENC_KEYS` (JSON `{keyId: base64}`), `TOTP_ENC_ACTIVE_KEY_ID`; recovery pepper `RECOVERY_CODE_PEPPERS` / `RECOVERY_CODE_ACTIVE_KEY_ID`;
IP-hash key `IP_HASH_KEY`.

## TOTP secrets

1. Add the new key to `TOTP_ENC_KEYS` (keep the old one) and set `TOTP_ENC_ACTIVE_KEY_ID` to the new id. Deploy web and worker. New enrolments use the new key.
2. Enqueue `security.totp-reencrypt` (maintenance queue, `{}`). It re-encrypts active and pending secrets in batches of 100, decrypts each result to verify it,
   and reports `rowsPerKeyId`, `removableKeys` and `done`.
3. **Remove the old key from the secret store only when `done` is true and the old id is in `removableKeys`.** The job never reports `done` while any row
   (TOTP or recovery code) still uses another key, or while any row failed to decrypt (`failed > 0`: investigate that user, do not delete the key).
4. Drill: run steps 1-3 in staging every quarter and record the report in the ops log.

## Recovery-code pepper

Codes are stored as HMACs and cannot be re-keyed. New codes use the active pepper id; the old pepper stays in the secret store while `rowsPerKeyId` shows rows for it
(users regenerate codes, or the rows expire). Same removal rule as above.

## IP-hash key

Rotate every 90 days. Old hashes disappear with `RET-IPHASH` (90 days), so no migration is needed; keep the old key for the one-day vote window only if abuse analysis needs it.

Tested by `apps/worker/src/security/totp-reencrypt.int.test.ts`.
