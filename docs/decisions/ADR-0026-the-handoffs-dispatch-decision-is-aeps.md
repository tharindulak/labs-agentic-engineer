# ADR-0026 — The handoff's dispatch decision is AEP's

The OpenChoreo SRE agent's handoff stage decided two things in its own Python,
and neither was its to decide.

`HandoffClassification.derive` read the remediation agent's action statuses and
said what they meant — code-level, config-level, mixed, or none. `needs_stage`
then turned that into a gate: `code_level` and `mixed` ran the stage, and the
other two skipped it.

Both were AEP's contract wearing OpenChoreo's clothes:

- **The rule was already ours, in Go.** `shouldEscalate` and `splitActions`
  (`services/aep-api/internal/ops/createreport/escalate.go`) read the same
  statuses on the way back in, to decide whether to file the issue the handoff
  should have filed. One fact, two derivations, in two languages, in two repos —
  and nothing keeping them honest with each other.
- **The name was already coupled across repos.** `skills={"coding-agent-handoff"}`
  is a literal in the agent image that must match a directory name in this repo,
  shipped by a ConfigMap from a shell script. Keeping it in step has been a
  hand-propagation across four files.
- **The gate produced a hole.** A `config-level` incident skipped the stage, so
  it produced **no issue at all**. Configuration had addressed the symptom and
  the incident left no record anybody could find.

## Decision

**AEP derives the handoff's classification and its adoption. The agent sends the
statuses and files every report.**

`ae_create_issue` takes `actionStatuses` — one entry per recommended action, in
the report's order, nullable — and answers the `classification` it derived. A
middleware in the agent pins those statuses onto the call, so no model re-reads
them. Three things follow, all server-side:

- **`config-level` is filed and not adopted.** Configuration already expressed
  every action, so a coding agent has nothing to work, while the incident still
  gets a ledger entry. This closes the hole above.
- **Everything else adopts, `none` included.** A report that reaches the stage
  carries an identified root cause. An unnecessary coding task is closed in
  minutes; a missed defect is permanent.
- **`config-level` filings get their own dedupe namespace.** Filed and unadopted,
  such an issue stays **open**, and dedupe matches any open issue under the key.
  Without the namespace it would absorb every later incident on that signature:
  `deduped: true`, nothing created, nothing dispatched — and because the report
  then carries an issue number, `shouldEscalate` returns early too. A genuine
  code defect arriving later would never reach a coding agent.

The classification never widens adoption past an explicit `adopt=false`, and a
caller that sends no `actionStatuses` keeps the previous behaviour exactly: it
adopts by default, its dedupe key is untouched, and no classification is
invented for it.

## The two rules stay two rules

`ClassifyActions` (`internal/ops/handoff_classification.go`) carries `derive`'s
semantics, **not** `splitActions`'. They disagree about an absent status, on
purpose:

| | absent status | why |
|---|---|---|
| `ClassifyActions` — before the handoff | **pending** → `code-level` | an unfiled defect is dropped for good, while an unnecessary issue is closed in minutes |
| `splitActions` — after, as the backstop | dropped | escalating on an action nobody classified would file work off a status remediation never asserted |

Collapsing them would have been silent and total. `remed_agent` defaults to
`false` and no installer sets `REMED_AGENT`, so on a fresh install every action
carries no status. Under `splitActions`' reading the gate answers "no code work"
for **every** incident, and escalation — sharing the function — files nothing
either. The whole loop would go quiet with no error anywhere. A test asserts the
two disagree deliberately.

## Consequences

- The agent's `derive`, `needs_stage` and `without_handoff` are gone. The
  `HandoffClassification` enum stays, as the type of the recorded field.
- The stage now runs for **every** report with an identified root cause, so a
  `none` or `config-level` incident pays a full stage — search and issue
  composition — before AEP decides the adoption. Accepted: the alternative was a
  separate gate tool, and this reuses a call that already answers `deduped`,
  `suppressed` and `adopted` the same way.
- An unanswered create call records `code_level`. The read side defaults an
  absent classification to `none` (`createreport/native.go`), which would
  relabel a real code-level incident as nothing-to-do on the report somebody
  triages.
- Nulls must survive the wire positionally. Filtering them out turns a report
  whose remediation stage never ran into an action-free one — the opposite
  conclusion, and the default shape on a fresh install.
- The descriptor's `call_arguments.action_statuses` and
  `answer_fields.classification` are optional, defaulting to AEP's own names, so
  a descriptor written before them still parses. Required would have turned a
  rolling upgrade into a startup crash on the ConfigMap already deployed.

## Related

- [ADR-0017](./ADR-0017-filing-an-issue-is-the-dispatch.md) — filing the issue is
  the dispatch; this ADR decides *whether* that dispatch happens.
- [ADR-0025](./ADR-0025-incident-identity-is-transport-carried.md) — the same
  principle for identity: facts about the alert travel out of the model's reach.
