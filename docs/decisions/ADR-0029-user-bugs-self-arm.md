# ADR-0029 — A user-reported bug's `bug` label is its own arming

**Status:** accepted · implemented, pending merge · 2026-09-09
**Related:** ADR-0011 (milestone is the unit of execution) · ADR-0017 (the
platform owns deploy) · ADR-0026 (deploy reconciles the version) · the
SRE/RCA incident-adoption path (`task.Commands.PromoteAndExecute` →
`Adopter.AdoptIssue`, `services/aep-api/internal/delivery/task/commands.go`)
· `docs/glossary.md` (*Arming label*, *Ledger issue*)

## Context

Arming (`aep`) is deliberately a human act everywhere else in this domain: a
`bug` label classifies an issue, `aep` says a human chose to spend money and
let the agent work it, and even the platform's own detected incidents are
filed as `bug` and left unarmed on purpose — "classification is not
permission" (`docs/glossary.md`, *Ledger issue*). The split exists because
arming stays auditable to a person from the issue timeline alone, and because
an armed issue bills real spend and, once merged, deploys to production
unattended.

A user reporting a bug against their own already-deployed app has been asking
for the opposite: file the issue, get the fix, no second click. Every `bug`
they file today needs a human to separately add `aep` (or call
`promote-from-issue`) before anything happens — friction with little safety
value for this one case, since the reporter and the person who would arm it
are usually the same actor.

## Decision

**For a `bug` issue whose source is `src/user` (explicit label, or absent —
the existing default), the `bug` label IS the arming label.** The moment such
a label lands on an issue — at creation or later, by anyone able to label the
repo's issues — it is adopted exactly as if a human had added `aep`: moved
into the deployed version's milestone, and a `task` run is started (or the
live one picks it up at its next cycle boundary), through the existing
`AdoptIssue` path. "Exactly as if" is literal — the platform stamps `aep`
itself as part of adopting the issue, because every consumer downstream of
adoption reads that label and nothing else, so an adopted issue without it is
a ledger issue whose run has no work to find.

Everything downstream of adoption is unchanged and stays fully unattended:
agent run → PR auto-merge → build fan-out → the supervisor's deploy reconcile
(ADR-0026). No new checkpoint is introduced between merge and deploy for this
path — gating after the fix is already merged would just leave it
undeployed, which defeats the purpose.

**Scope, deliberately narrow:**
- Only `src/user`. The platform-detected sources (`src/build`, `src/deploy`,
  `src/validation`) stay ledger-only exactly as before; `src/incident` keeps
  its own existing, separate automatic path unchanged. Widening this to
  platform-detected failure classes is a materially bigger trust bet and was
  explicitly deferred.
- Only forward from ship date. Pre-existing open `bug` issues are not swept
  or retroactively adopted — nobody just decided, today, to spend on those.
- No new label. Adoption is marked with a bot comment ("auto-adopted") on the
  issue instead — a marker label would blur the two existing independent
  axes, `kind` and `source`.
- If the project has no deployed version yet, there is nothing for the issue
  to join; the platform leaves an explanatory comment instead of adopting.

## Accepted risk

This removes the human-intent gate for the one population it applies to.
Explicitly, and by choice, not by oversight:

- **No trust check on the labeler.** Anyone able to attach `bug` to an issue
  on the repo triggers a billed agent run and an eventual production deploy —
  the same as GitHub's own label-write permission today, with no additional
  verification.
- **No cost or concurrency cap** beyond the existing one-live-run-per-milestone
  throttle. An org running many projects can have that many auto-armed runs
  going at once, each billing its own org key (ADR-0016).
- **No off switch.** This is unconditional behaviour for every project in
  every org — there is no per-project or per-org setting to disable it.

Each was raised and the trade-off taken deliberately: the friction being
removed is one click by the same person who would otherwise make it, and a
trust check, a cap, or a toggle were each judged to be gating a problem that,
for `src/user` reports, mostly isn't there. If that changes — spam reports,
cost surprises, a team wanting to opt out — the fix is additive: none of the
above closes the door on adding a check, a cap, or a switch later without
reversing this decision.

## Not done, deliberately

- **A trust/role check on who applied the label.** Considered and rejected —
  see *Accepted risk*.
- **A per-org concurrency or spend cap on auto-armed runs.** Considered and
  rejected for the same reason.
- **A per-project/org opt-out.** Considered and rejected; this is
  unconditional.
- **A backfill sweep of pre-existing open bugs.** Would silently start paid
  runs and deploys for issues nobody acted on today, as a side effect of
  shipping unrelated code.
- **A distinguishing label (e.g. `src/auto`).** Would conflate the `source`
  axis (who found it) with a new "who armed it" concept; a bot comment
  carries that fact without touching the label vocabulary.
