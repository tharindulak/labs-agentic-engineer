# ADR-0008: Console gains an Alerts surface — non-goal narrowed, IA extended

- **Status:** Accepted — the bell's half of "two entry points" superseded
  2026-09-16 by
  [ADR-0032](ADR-0032-the-bell-rings-for-attention-not-for-every-report.md):
  the bell now carries issue attention events, not every RCA report. The
  left-nav section, the read-only stance and the non-goal narrowing below are
  unchanged.
- **Date:** 2026-07-09 (grilling of the RCA-agent alert notification
  features, [#154](https://github.com/wso2/labs-agentic-engineer/issues/154),
  [#155](https://github.com/wso2/labs-agentic-engineer/issues/155))
- **Context:** the PRD's non-goals stated "Dev-environment visibility only
  (for now). No prod ops, alerting, or observability surface." Both #154
  (a top-nav notification bell) and #155 (a dedicated global "Alerts"
  left-nav section) surface RCA reports produced by the OpenChoreo
  SRE/RCA-agent handoff (`docs/developer-guide/sre-handoff-runbook.md`) —
  genuinely new alerting data flowing into the console, not a
  reinterpretation of data it already had. That contradicts the blanket
  non-goal as written. Separately, `docs/design/observability.md` is a
  much larger, still-unapproved proposal (WS1–WS6: logs, metrics, traces,
  agentic telemetry, alerting/incidents, platform self-observability);
  #154/#155 are scoped narrowly to RCA-agent alerts only and are not part
  of that proposal or its approval.

## Decision

Narrow the non-goal from a blanket "no alerting" to explicitly exclude
**RCA-agent alert notifications** (issue/task/deploy-status surfaced from
the SRE-agent handoff pipeline) from what's disallowed. General
alerting/observability (metrics, logs, traces, alert-rule authoring,
incident management) remains a non-goal and is out of scope for both
#154 and #155; that ground stays with `docs/design/observability.md`'s
own (separate, pending) design review.

The console's information architecture gains two Alerts-related surfaces:
- A global, org-wide **top-nav notification bell** (#154) — quick
  awareness, read-only, client-tracked unread state, no dedicated page.
- A global, org-wide **"Alerts" left-nav section** (#155), at the same
  level as "Projects" — a browsable list + a per-alert Stepper progress
  view (Alert Received / Issue Created / Coding Handover / Verify Fix),
  entirely derived client-side from existing data (no new stored state
  machine).

Both are read-only from the console's side: no triage actions, no
"mark verified"/acknowledge mutations, no alert-rule or incident
management UI.

## Consequences

- `apps/console/PRD.md`'s non-goals section is amended when #154/#155
  ship: the "no prod ops, alerting, or observability surface" line is
  qualified to carve out RCA-agent alert notifications specifically.
- The PRD's Information architecture section gains "Alerts" (global,
  two entry points: top-nav bell + left-nav section) alongside Home,
  Project view, and Admin.
- Future alerting/observability work (metrics, logs, traces, alert-rule
  authoring, incident management) still requires its own design review
  and PRD change — this ADR does not pre-approve
  `docs/design/observability.md`'s broader scope, and features must not
  cite this ADR to justify building those pillars without that review.
- Any future feature that wants to add mutation/triage actions to alerts
  (acknowledge, dismiss, "mark verified," manual dispatch from the
  console) must explicitly supersede the read-only stance recorded here
  and in #154/#155's grilling decisions.
