# ADR-0011: Usage is persisted as tokens + model id; USD is always derived at read time

**Status:** Accepted (2026-07-17, amended 2026-07-21) · **Issue:** [#245](https://github.com/wso2/labs-agentic-engineer/issues/245)

## Context

Agent work runs through two runtimes with different cost reporting: the coding
runner's Claude Agent SDK returns per-run token usage *and* a ready-made
`total_cost_usd`; the spec/design agent (Vercel AI SDK) returns token counts
only. Cost surfaces in the console must reconcile across both, and Anthropic
per-token prices change over time.

## Decision

Every usage record persists **raw token counts (input, output, cache read,
cache write) plus the model id** — never a dollar amount. `aep-api` derives
USD at read time from configured per-token-class rates (checked-in defaults,
overridable via deployment config/env). The rates never leave the server —
clients only see the derived `costUsd` (the platform runs a single model, so
there is no client-side pricing use case). Provider-computed cost figures
(e.g. the SDK's `total_cost_usd`) may be logged as a cross-check but are
never displayed or persisted as truth.

## Consequences

- One formula prices every surface (turns, tasks, builds, per-phase rollups)
  — figures always reconcile.
- A rate fix retroactively corrects all displayed history; nothing stale is
  frozen in the database.
- Displayed USD for old records shifts when configured rates change — cost
  views are a *current-prices* lens, not an invoice. Anything invoice-like
  would need a separate snapshotting decision.
- Tokens stay the stored truth, so re-pricing (e.g. if the platform ever runs
  multiple models again) needs no data migration.

## Rejected

- **Display provider cost where available** — two irreconcilable sources
  (SDK dollars vs catalog math) across the two runtimes.
- **Persist computed USD at capture time** — stale rates freeze wrong numbers
  forever; a mispriced catalog entry becomes permanent history.
