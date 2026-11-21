# ADR-0009: Internationalisation readiness (English default)

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-21 |
| **Deciders** | Software Architect (author). CEO (approval). Product owns launch languages (G-1) |
| **Task** | #24 (M1-T1) |
| **Related** | [open-questions.md §2](../architecture/open-questions.md#2-language--localisation-open) (G-1..G-9), ADR-0001 (Tailwind logical properties), ADR-0005 (unsupported-language → human), ADR-0007 (worker renders emails), [design/a11y-checklist.md](../../design/a11y-checklist.md) |

## Context

Phase 1 launches **in English only** (working assumption G-1). The launch languages are still OPEN. Retrofitting i18n later is expensive in three places:

1. **Hard-coded strings** spread across components, Server Actions and email templates.
2. **URLs.** Adding a locale prefix later forces redirects and SEO churn.
3. **Data.** Text rendered once and stored in the database cannot be re-rendered in the reader's language. Legal texts stored without their language are poor evidence.

We want the cost of a second language to be "translate the message files", not "refactor the app". We also do not want to build anything we do not need yet.

## Decision

### 1. Locales

- Locales are identified by **BCP 47 tags** (`en`, later e.g. `de`, `fr-CA`). `DEFAULT_LOCALE = "en"` and `SUPPORTED_LOCALES = ["en"]` live in the shared i18n package (§2).
- **Resolution order** for a request:
  1. explicit URL prefix (only once a second locale exists)
  2. `User.locale`
  3. `NEXT_LOCALE` cookie
  4. best match from `Accept-Language`
  5. `en`
- `<html lang dir>` comes from the resolved locale. The scaffold's hard-coded `lang="en"` is replaced in M2.

### 2. UI text: next-intl and ICU messages

- **next-intl** is the library. It supports the App Router and React Server Components, ICU MessageFormat and typed keys.
- Messages live in a shared workspace package `packages/i18n` (`messages/en.json` + config + formatters). The **web app and the worker** (emails, ADR-0007) both use it.
  The worker renders text with `createTranslator`.
- Rules:
  1. **No user-facing string literals** in `apps/web/src` components, Server Action error messages or worker templates. ESLint `react/jsx-no-literals`
     (with an allow-list for punctuation and test files) enforces this in CI.
  2. **ICU only:** use plurals, `select` and arguments. Never concatenate translated fragments. Keys name a whole sentence.
  3. **Namespaced keys** follow `feature.component.key`. Enum labels use `enums.<EnumName>.<VALUE>`, so the UI never shows a raw enum value. A unit test checks that every
     user-visible Prisma enum value has an `en` key.
  4. **Typed keys:** the message type is derived from `en.json` (next-intl `AppConfig`), so a missing key fails `tsc`.
  5. **Pseudo-locale `en-XA`** (accented and expanded by about 35 %) is enabled in dev and test. A Playwright smoke test runs in it to catch hard-coded strings and truncation.

### 3. URLs

- **No locale prefix while English is the only locale.** When a second locale ships we use next-intl `localePrefix: "as-needed"`:
  English URLs stay exactly as they are (no redirects, no SEO churn), other locales get `/de/...`, and `hreflang` alternates plus `x-default` are added.
- Slugs and handles are language-neutral identifiers (§6), so the same product URL works in every locale.

### 4. Formatting, time and units

- Dates, numbers, relative times and lists are formatted with `Intl`, through next-intl's formatter. There is no manual formatting.
- Timestamps are stored in **UTC** (ADR-0004). The UI renders them in the browser's time zone. Emails render them in **`User.timeZone`** (new, IANA name), or in UTC with an explicit "UTC" label.
- Measurements in `Product.specs` are stored in canonical SI units and converted at render time (G-9). Phase 1 has no prices. If prices are added, store integer minor
  units plus an ISO 4217 code.

### 5. Database rules

| Data | Rule |
|---|---|
| **System-generated text** (notifications, emails) | **Store keys and parameters, never rendered text.** `Notification.type` + `data` is rendered at read or send time in the recipient's locale (already modelled) |
| **Legally significant text** shown to a user | Store it **exactly as sent, with its language**: `EnforcementAction.publicReason` + **`publicReasonLocale`** (new), `LegalAcceptance.documentLocale` (new, G-8). Staff pick reason templates by `reasonCode`. The template is rendered in the subject's locale at write time and staff can append free text |
| **User content** (reviews, posts, comments) | Stored as written, normalised to Unicode NFC. Its language is detected during AI moderation (`Review.language`, BCP 47). Posts and comments get the same column additively if needed (G-3). When the content language differs from the UI locale it is rendered with a `lang` attribute (WCAG 3.1.2). No machine translation in Phase 1 (G-4) |
| **Catalog text** (product, category, attribute labels) | Single-language base columns hold the default locale. If G-5 says "translate", we add sidecar tables `*_translations` with PK `(entityId, locale)` that fall back to the base column. We do **not** use JSON columns per locale, because they cannot be indexed or FULLTEXT-searched |
| **Staff free text** (`Appeal.decisionNote`, `PurchaseProof.decisionReason`, internal notes) | Stored as written. Staff are expected to write in the subject's language, and templates help |

### 6. Text handling

- MySQL uses `utf8mb4` with `utf8mb4_0900_ai_ci` (ADR-0004). **Handles are ASCII `[a-z0-9_]`** to prevent homoglyph spoofing. Display names allow any Unicode
  but are NFC-normalised and stripped of bidi control characters. Slugs are transliterated to ASCII.
- Length limits: zod `.max()` counts UTF-16 code units and MySQL `VARCHAR(n)` counts characters, so zod is never looser than the database. That is the safe direction.
- Search: MySQL FULLTEXT with the default parser works for space-delimited languages. CJK would need an `ngram` index or the external engine option in T-3.

### 7. Layout and moderation

- Tailwind **logical properties** only (`ms-`/`me-`/`ps-`/`pe-`, `start`/`end`), with `rtl:` variants for directional icons (G-7). Designs leave about 35 % room for text expansion.
- AI moderation of a language the provider does not support is UNSURE, and a human decides (G-6, ADR-0005).

## Alternatives considered

| Option | Why not |
|---|---|
| Defer all i18n until a second language is needed | Every string, URL and stored message would need to be revisited. Retrofitting typically costs far more than starting with message keys |
| Locale prefix from day 1 (`/en/...`) | Longer URLs for a single-locale product, and it buys nothing that `as-needed` does not |
| `react-i18next` / `i18next` | Mature, but its RSC and App Router support is less direct than next-intl's. ICU needs a plugin |
| Translate catalog columns as JSON (`name: { en, de }`) | Cannot be indexed, unique-constrained or FULLTEXT-searched, and Prisma cannot type it. Sidecar tables are additive and indexable |
| Store rendered notification text | It cannot be re-rendered in another locale and it duplicates templates in data |

## Consequences

**Positive**

- A second language means translating `messages/*.json` plus the optional sidecar catalog tables. There are no URL or schema migrations for existing data.
- Legal texts and statements of reasons record exactly which language the user saw.
- Typed keys and the lint rule stop new hard-coded strings in CI.

**Negative / risks**

- There is a small daily overhead: developers add keys instead of literals. Mitigation: typed keys and editor autocompletion.
- Staff free text is single-language. This is acceptable for Phase 1, with templates as mitigation.
- Three columns are added now that are inert until a second locale exists: `User.timeZone`, `LegalAcceptance.documentLocale`, `EnforcementAction.publicReasonLocale`.

## Follow-ups

- **M2 (Frontend):**
  - Create `packages/i18n`, add next-intl with `en.json` and set `<html lang dir>` from the locale.
  - Add the `react/jsx-no-literals` lint rule, the enum-coverage test and the `en-XA` pseudo-locale smoke test.
- **M2 (Backend):** worker email rendering with `createTranslator` and `User.locale` / `User.timeZone`.
- **Product:** answer G-1 and G-5 before any second-language work starts.
