# ADR-0023 — A cycle can end because no code change is possible

A cycle could only end one way: by landing a merged pull request. So an agent
that examined its work and concluded **nothing needed changing** had no way to
say so. It commented on the issue and exited; the supervisor waited out
`cycleLandingTimeout` (2h), called it agent death, spent a re-dispatch, and a
second agent reached the same conclusion — the run finally failing with
`redispatch-budget`. About four hours to arrive at a wrong answer about an agent
that was right.

This was found on a fixture built to exercise the alert → handoff → coding-agent
loop. Its PRD *requires* the behaviour the alert fires on:

> *"I want Service2 to **delay 8 seconds**…"* (story 3)
> *"I want Service1 to **give up waiting after 5 seconds**…"* (story 4)
> *"I want Service1 to **log an error message** when a timeout happens."* (story 6)
> *Out of scope: **configurable timeout or delay values**.*

Every request is specified to time out and log an error, so the alert fires on
every request, forever. The coding agent worked this out unaided and said so:

> *"AC-003-a fixes service2's delay at ~8s and AC-004-a fixes service1's timeout
> at ~5s, so every call between them is structurally guaranteed to time out — and
> AC-006-a mandates an error-level log every time... this alert is expected to
> fire on every request by design."*

It was right, and the platform had no vocabulary for being told so.

## Decision

**A coding agent may end a cycle by resolving its work rather than changing
code**, and that verdict is durable.

1. **It closes the issue as `not_planned`**, with its reasoning as a comment.
   GitHub's own vocabulary already means precisely "somebody decided against
   doing this work", so no new label is invented.
2. **The cycle ends.** When a milestone's working set empties under a cycle that
   opened NO pull request, the event plane signals `SigRunNoWork`; the run reads
   it as `landingNoWork` → `cycleNoWork`, which is not a failure. The boundary
   re-polls, finds nothing to work, and settles the run the ordinary way.
3. **The verdict suppresses re-filing.** A later alert whose dedupe key matches a
   `not_planned` incident issue files nothing and dispatches nothing; the answer
   is returned as `suppressed`, pointing at the issue that holds it.

A human who disagrees reopens the issue. It becomes open agent work again and the
next alert dedupes onto it exactly as normal — the escape hatch needs no
mechanism of its own.

## Why the judgment belongs after dispatch

The alternative was to give the SRE handoff access to `specs/` so it could refuse
to file changes the spec forbids. It was rejected: only the coding agent has the
repository, and it must make this judgment anyway — a pre-filter duplicates it,
doubles the surface where a spec can be misread, and gives the RCA agent a repo
dependency the design deliberately kept out.

The accepted cost is **one wasted cycle per novel signature**: the first alert of
any new fingerprint still files, dispatches and codes before being answered. It
terminates cleanly and never repeats, which is the difference that matters.

This does mean the handoff will keep filing issues asking for changes the spec
forbids — it asked for a configurable timeout that the PRD lists as out of scope,
and PR #7 shipped it. The handoff is deliberately biased toward filing, because
an unfiled defect is dropped for good; the correction now happens where the
evidence is.

## Consequences

- **A merge must win the race.** A merge empties the working set too, so
  `landingNoWork` deliberately does not end the attempt on its own: the cycle
  record is re-read first, and a real merge lands normally. Belt and braces, the
  event plane also refuses to signal for a cycle that already holds a pull
  request.
- **Agent death still means agent death.** An agent that merely produces nothing
  leaves the working set untouched, so it still spends its budget and still ends
  at `redispatch-budget`. The new path requires the work to be *resolved*, which
  only a deliberate close can do.
- **`not_planned` now carries weight in three places** and consistently: it is
  never reopened by a recurrence (ADR-0021), it ends a cycle here, and it
  suppresses the next filing. All three say the same thing — the platform does
  not overrule somebody who looked.
- **Suppression is indefinite.** Bounding it by time or by the next deployment
  was considered and dropped as bookkeeping for a case that may never arise;
  reopening the issue is the intended and only reset.
- **The fingerprint flaw is untouched.** A fix that edits the error log changes
  the signature it was derived from, so a recurrence can file as a new incident
  and reset the attempt counter — which is how issue #9 filed fresh instead of
  reopening #6. Suppression keyed on the dedupe label therefore does not hold
  across a fix that changes the logging. That is a separate defect and still
  open.
