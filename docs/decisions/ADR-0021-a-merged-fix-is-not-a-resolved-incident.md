# ADR-0021 — A merged fix is not a resolved incident

The SRE/RCA handoff files a GitHub issue, `AdoptOnCreate` hands it to a coding
agent (ADR-0017), the agent opens a pull request carrying `Resolves #N`, and the
merge policy squash-merges it (`eventcore/merge.go`). GitHub then closes the
issue.

That close asserts something the platform does not know. At merge time nothing
has observed the deployed system; the only evidence is that an agent wrote a diff
it believed addressed a root cause. The assertion was also **terminal**: the
dedupe lookup in `sourcecontrol/issue_service.go` matched only issues in state
`open`, so once the issue closed it became invisible to its own fingerprint. The
next occurrence of the identical error signature filed a *fresh* issue, and three
things were lost with the old one — that a fix had already been attempted, what
that fix was, and that the platform had been wrong about this incident before.
The coding agent dispatched onto the new issue started from exactly the same
blank page as the one that had already failed.

Two symmetric consequences of "the merge closed it" cause this: the platform
never learns it was wrong, and it never hesitates before being wrong again.

## Decision

**Closing an incident issue is a claim the platform must be able to retract, and
merging an incident fix is a step it must be able to hesitate before.**

### 1. A recurrence reopens the issue

The dedupe path (which already fetches `state=all`) stops ignoring closed issues.
Matching on the `dedupe:` label:

- **open** → dedupe, unchanged. That issue's run owns its dispatch.
- **closed, `state_reason == completed`, carrying `sre-agent`** → a *recurrence*.
- **closed, `state_reason == not_planned`** → never. A human said no.

A recurrence, in order: read the issue and count its `## Recurrence` sections to
get attempt *n*; append `## Recurrence <n>` with the new evidence; reopen;
**re-home**; adopt.

Re-home is the step that makes this more than `AdoptIssue` with a reopen in
front. `AdoptIssue`'s first rule is *"an issue that already has a milestone keeps
it. The human put it there."* — true of a milestone a human chose, and false of
one adoption itself assigned months ago to a version that is no longer deployed.
So reopening re-resolves the adoptable milestone from scratch, exactly as
`adoptableMilestone` does for a bare issue, and moves the issue there before
stamping `aep` and starting or waking the run. With no adoptable milestone the
issue is still reopened and still appended to, and comes back `adopted: false`
with an `adoptionError` — a ledger entry, the same refusal shape ADR-0017 chose,
for the same reason: nothing retries a handoff.

The body edit lands while the issue is still closed and therefore outside every
working set, so a full-body `EditIssueBody` cannot race a run that is reading it.

`IssueResult` and `HandoffResult` gain `reopened` and `recurrence`, stamped from
the answer rather than restated by the model — the rule ADR-0017 established for
`adopted` / `adoptionError`, for the same reason: the console's Alerts list
serves this snapshot to a human who is triaging.

### 2. An incident merge is gated on a declared confidence

The coding agent states, in its pull request body, whether it believes the fix is
right. High is earned against all of a stated bar — it addresses the root cause
the issue names rather than a neighbouring one, the implicated code path is
pointed at rather than inferred, the failure mode is now covered by a test or
check that would have caught it, and nothing material was guessed at. Miss one,
or be unsure, and it is low.

`decideAutoMerge` gains one condition, **scoped to pull requests that resolve at
least one `sre-agent`-labelled issue**. High merges as today; low, missing, or
unparseable holds. The seam is where its own doc comment reserved it: *"Review
logic (approvals, checks, a human gate) arrives later BEHIND this function."*

A held pull request needs a run state, because the existing one is a lie. A
cycle whose pull request has not merged within `cycleLandingTimeout` (2 hours) is
read as *agent death* and spends a re-dispatch, ending at
`RunReasonRedispatchBudget`. Applied to a human review queue that would report
agent failure for a colleague at lunch — and would dispatch a second agent over
the same issue while the first one's finished work sat unread. So `held` joins
`landingMergeSignalled` / `landingConflict` / `landingTimeout` as a landing
outcome of its own: the deadline stops, no budget is spent, the run parks, and a
human merging resumes it through the `pull_request` webhook that already exists.
It parks indefinitely — a gate that opens on a timer is not a gate — and the wait
is made loud instead of bounded.

## Rejected alternatives worth remembering

**Not closing on merge at all**, letting a verifier close once the incident stops
recurring, is the semantically honest model and was rejected on blast radius. The
issue would stay in the milestone's working set after merge, which stalls settle,
blocks supersede, and keeps the run from ever finishing. `Resolves #N` is also
not merely GitHub's closing keyword: `eventcore/resolves.go` parses it as the
platform's read of what a cycle completed, and it is the evidence
`decideAutoMerge` rests on. Reopening leaves all of that untouched.

**A time window on the reopen.** Rejected: a recurrence is a recurrence whenever
it happens, and an error signature that resurfaces after a year of health is
still better served by the thread that records what was already tried than by a
blank new issue. The cost is accepted — an old thread can be reopened long after
its context has moved on.

**A recurrence ceiling** that stops adopting after *n* attempts. Rejected: the
platform does not give up on a system that is still broken. Escalation past the
threshold is therefore visibility only — the recurrence is reported, and worked
anyway. This is a real exposure, because the platform auto-merges: the loop's
only brake is that a repeat alert dedupes onto the open issue while it is being
worked, which bounds the loop's *rate* to one full run-build-deploy cycle and its
*count* not at all.

**Letting a recurrence override the declared confidence** — forcing a hold from
attempt 2, on the grounds that the platform has direct evidence a confident-
looking fix already failed. Rejected in favour of one signal and one rule. The
declaration decides on every attempt. This puts real weight on the agent knowing
its own track record, which is why the Recurrence section is written by the
platform and states in words that a merged fix already failed: the instruction
sits in the document the agent is guaranteed to read, where no skill drift can
lose it.

## Consequences

- **Only the incident path changes.** Spec-build pull requests never see the
  confidence gate, so the loop that has to run unattended overnight cannot freeze
  on a missing line. Within the incident path the default is the opposite —
  missing holds — because a fix going at a live production system must not
  auto-merge on an agent's forgetfulness. Fail-closed is affordable here only
  because `held` parks without spending budget.
- **One incident, one issue, forever.** A long-running incident accumulates
  `## Recurrence` sections in one body rather than a scatter of issues sharing a
  fingerprint. Bodies grow; that is the price of the history being in one place.
- **The platform reads a body to make a decision, in one place.** Attempt *n* is
  counted from the `## Recurrence` headings, which is the pattern the retired
  machine block was removed for (`delivery/labels.go`: *"Nothing here is parsed
  out of an issue BODY: bodies are prose"*). It is tolerated because the platform
  both writes and reads that section and nothing else depends on it — but it is a
  known exception, not a precedent, and a label is the fallback the moment a
  second decision wants the number.
- **`AE-HANDOFF-DESIGN.md` §1 is wrong and stays worth fixing.** *"No auto-merge.
  The coding agent stops at 'PR opened'"* is true of the agent and materially
  misleading about the platform, which merges. The confidence gate is the first
  thing that makes a human gate real rather than assumed.
- **A held pull request closed WITHOUT merging must also resume the run.**
  `OnPullRequestClosed` deliberately ignores unmerged closes, leaving the
  decision to the supervisor at its next cycle boundary — but a parked run has no
  next boundary until something lands. A human saying "not this" has to be a
  landing too, or the run parks forever.
