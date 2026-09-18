# ADR-0037 — `escalate.go` is retired

ADR-0036 removed the SRE agent's own skip-filing gate: the stage now runs for
every report with an identified root cause, and AEP derives the classification
from `actionStatuses` server-side rather than trusting a Python-side verdict.
That closed the failure mode `escalate.go` existed to catch from the other
direction — a report arriving through `POST /rca-agent/reports` already
carrying a `classification` and `diagnosis` a model had computed itself, which
`shouldEscalate`/`splitActions` re-derived from the same statuses to decide
whether the handoff should have filed and didn't.

Separately, this repo retired the calling mechanism that endpoint was built
for. ADR-0035's identity-header channel and the forked `tharindulak/sre-agent`
image are gone; the current SRE agent is the vanilla image plus a generic
extensions mechanism (`deployments/sre-agent-extensions/`), and its
remediation stage calls `ae_create_issue` directly. `CONTEXT.md` makes that
call unconditional — *"Before you end this turn, for any RCA report with an
identified root cause, you MUST call `ae_create_issue`. Search alone is never
a valid stopping point."* Nothing in the current agent produces the structured
`classification`/`diagnosis`/action-status report shape `POST
/rca-agent/reports` expects.

ADR-0035 warned against exactly the reasoning that follows: *"quiet logs must
not later be read as evidence the path is unreachable and safe to delete."*
This is not that inference. It is a direct check: `aep-mcp-server`'s tool
catalogue has no tool that maps to that report shape, and `rca_agent_reports`
holds zero rows despite dozens of live RCA runs against the current
architecture across three test projects. The calling path is not rare — it no
longer exists.

## Decision

**Delete `escalate.go` and everything that existed only to feed it:** the
`shouldEscalate`/`splitActions`/`escalationIssue` functions and their tests,
the `IssueEscalator`/`FiledIssue` port on `ops.Deps`, the `opsIssueEscalator`
adapter in `app/eventcore_adapters.go`, and `createreport/native.go`'s
`nativeAction`/`nativeActions`, which parsed recommended actions for
`splitActions` alone.

`POST/GET/LIST /rca-agent/reports` and the `rca_agent_reports` table are
untouched. A report submitted through that endpoint is still stored and
correlated against live executions exactly as before — it simply no longer
files an issue as a side effect of arriving without one.

## Consequences

- **ADR-0035's "quiet backstop" gap is closed, not deferred.** The backstop is
  gone; there is nothing left to mistake for dead code later.
- **ADR-0035's `splitActions` absent-status gap is moot.** The function it
  named no longer exists to have the blind spot.
- **ADR-0036's "the two rules stay two rules" section is now historical.**
  `ClassifyActions` (`internal/ops/handoff_classification.go`) is the only
  classification rule left; there is no second derivation of the same
  statuses to disagree with it on purpose.
- **If a future caller ever posts that structured report shape again**
  (a different RCA integration, a reintroduced Python-side classification),
  this decision should be revisited — nothing here prevents adding a fresh
  backstop scoped to that caller.

## Related

- [ADR-0035](./ADR-0035-incident-identity-is-transport-carried.md) — recorded
  `escalate.go` as a deliberate quiet backstop; this ADR retires it.
- [ADR-0036](./ADR-0036-the-handoffs-dispatch-decision-is-aeps.md) — removed
  the gate `escalate.go` backstopped, from the filing side.
