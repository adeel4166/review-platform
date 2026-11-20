# Architecture Decision Records

We record significant architecture decisions as ADRs (lightweight Michael Nygard format).

## Rules

- One decision per file: `NNNN-kebab-title.md`, numbered sequentially and never reused.
- New ADRs start as **Proposed**. An ADR becomes **Accepted** when its PR is merged to `main` with CEO approval.
- Accepted ADRs are not rewritten. To change a decision, add a new ADR and mark the old one **Superseded by ADR-NNNN**.
- Small clarifications (typos, links, follow-up status) may be edited in place.
- Use [`template.md`](./template.md).

## Index

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](./0001-technology-stack.md) | Technology stack and runtime topology | Proposed | 2026-11-20 |
| [0002](./0002-authentication-and-2fa.md) | Authentication, sessions and two-factor authentication | Proposed | 2026-11-20 |
| [0003](./0003-multi-role-permissions.md) | Multi-role permission model | Proposed | 2026-11-20 |
| [0004](./0004-data-model-conventions.md) | Data model conventions | Proposed | 2026-11-20 |
