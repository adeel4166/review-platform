# ADR-0022: Proof redaction runs in-house in the `media` group; only redacted pages reach an AI provider

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-22 |
| **Deciders** | Software Architect (author). CEO (approval). Legal input pending (L-5, L-6) |
| **Task** | #67 (M4-01) |
| **Related** | [ADR-0008](./0008-verified-buyer-approach.md) §5 (pipeline), [m4-m5-spec.md §5.5](../architecture/m4-m5-spec.md#55-redaction-mediaredact-adr-0022), threat-model R-2, R-3, R-6, open questions T-5, C-4, L-6 |

## Context

ADR-0008 requires that only redacted data reaches AI providers (R-3). Redaction itself needs OCR of the **original**
receipt to find names, addresses, card fragments and order numbers. If OCR is a cloud API, the original goes to a
third party, which breaks R-3 and widens L-6. Open question T-5 left the engine open behind a `ProofRedactor` interface.

Two more points are open:
- the `orderReferenceHash` HMAC key was planned for `web` and `worker-core` only (threat-model secrets table), but
  the order number is only known inside the job that runs OCR;
- when to delete originals (C-4).

## Decision

1. **OCR and PII masking run in-house**, as job `media.redact` in the `media` worker group, with `tesseract` and
   `zbarimg` inside the parser sandbox (no network namespace, read-only filesystem). Originals never leave our
   infrastructure. The `ProofRedactor` interface stays, so a provider can replace it later if Legal allows.
2. **Fail closed.** With low OCR confidence, few words or a detector error, everything except the merchant, date and
   total regions is masked. If none of those is found, the whole page is masked.
3. **Only redacted page images** (plus product name and brand) go to the external `ProofExtractor` (AI hints), from
   `verification.assess-proof` in the `core` group. It uses a zero-retention flag, a daily budget, and falls back to
   "no hints". It never decides.
4. **The `media` group gets `ORDER_REF_HMAC_KEYS`** (amends the threat-model secrets table). The order number is
   hashed in job memory and dropped. OCR text, boxes and raw values are never persisted, logged or put in a payload.
   The `media` group still has no AI key, SMTP or 2FA secrets (startup assertion).
5. **Originals are purged at decision** by default (C-4 recommendation, threat-model G-10). Appeals use the redacted
   copy. The setting `PROOF_ORIGINAL_RETENTION=APPEAL_WINDOW` restores the 30-day window if Legal requires it.
   Until the M6 break-glass (`proof.view_original`, PRV-003) exists, no staff route returns an original.

## Alternatives considered

| Option | Why not |
|---|---|
| Cloud OCR/redaction API | Sends originals to a processor (R-3, L-6). Best accuracy, but needs a DPA, a region pin and a DPIA before launch |
| Client-side redaction only | Optional extra; users skip it, and it cannot be trusted. Server-side redaction runs anyway |
| OCR in the `core` group | `core` has network access and AI keys. Parsing untrusted documents there breaks the U-1 sandbox model |
| Keep raw order numbers encrypted for later hashing | Stores PII we do not need. The keyed hash is enough for duplicate detection |

## Consequences

**Positive:** originals stay inside our infrastructure, and the parsers run sandboxed. The AI provider sees only masked
pages. Minimisation by default.

**Negative:** Tesseract is less accurate than cloud OCR, so `FULL_MASK` will be more common and staff will reject more
proofs as `UNREADABLE`. The worker image grows (tesseract, poppler, zbar). The HMAC key now lives in three groups,
which widens the R-6 blast radius slightly (mitigation: key id rotation, `orderReferenceKeyId`).

## Follow-ups

- M4-05: implement per m4-m5-spec §5. Security update to the threat-model secrets table (R-6 row).
- Legal: L-5/L-6 confirm `AT_DECISION` and the AI processor terms. Measure the `FULL_MASK` rate after launch, and
  revisit T-5 if it is above 30 %.
