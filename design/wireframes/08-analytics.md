# 08 · Analytics dashboards

Two audiences, same component set. Charts follow the `dataviz` guidance: every chart has a text summary and a data-table alternative; colour never the only encoding (patterns/labels/markers); palette from tokens (add chart categorical colours in implementation task M2+ via this file's contrast checker).

## 8.1 Seller analytics `/seller/{id}/analytics` (OWNER/MANAGER; RESPONDER read-only)
```
┌ Date range ▾ (Last 30 days | 90 | Custom)   Product ▾   [Export CSV]       ┐
│ KPI row (stat tiles, each: label · value · delta text "▲ 0.2 vs prev period")│
│ [Avg rating 4.3] [New reviews 128] [Verified share 62%] [Reply rate 81%] [Median reply time 9h]
├────────────────────────────────────┬─────────────────────────────────────────┤
│ Rating over time (line)            │ Star distribution (bar)                 │
│ [View as table]                    │ [View as table]                         │
├────────────────────────────────────┼─────────────────────────────────────────┤
│ Review volume by product (table, sortable)  │ Top themes / keywords (list with counts) │
├────────────────────────────────────┴─────────────────────────────────────────┤
│ Moderation outcomes for our content: published · pending · rejected · appeals│
└──────────────────────────────────────────────────────────────────────────────┘
```
Metrics only from published data; no reviewer PII; small-n suppression ("Not enough data") below threshold.

## 8.2 Platform analytics `/admin/analytics` (ADMIN; `analytics.read`)
Tabs: **Overview** (DAU, new reviews, publish rate) · **Moderation** (AI verdict mix CLEAN/UNSURE/VIOLATION, hold-lane backlog and age, post-review completion vs 24 h SLA, appeal overturn rate, AI-failure rate, per-moderator throughput — visible to ADMIN only) · **Trust & abuse** (reports by reason, strikes, enforcement, rate-limit hits, suspected fake-review clusters) · **Media** (upload success, scan rejects, transcode time, storage) · **Queues/health** (job lag, failures; links to ops tooling).
Alert thresholds shown as a labelled reference line with text ("SLA 24 h") and a status chip (OK / At risk / Breached — icon + text).

## Shared chart/dashboard rules
- Tile = `<section>` with heading; value announced in full ("Average rating 4.3 out of 5, up 0.2").
- Charts: `role=img` + `aria-label` summary + adjacent "View as table" toggle (real `<table>`); tooltip content also reachable by keyboard (focusable points / table).
- Responsive: tiles 1 col (mobile) → 2 (tablet) → 5 (desktop); charts stack; tables scroll inside a focusable region with `aria-label`.
- States: loading skeleton · empty (no data in range) · error with [Retry] · stale-data notice with "Updated {time}".
