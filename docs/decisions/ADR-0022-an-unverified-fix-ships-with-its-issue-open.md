# ADR-0022 — An unverified fix ships, with its issue left open

ADR-0021 put a human in front of the merge: an incident fix that did not declare
`Confidence: high` was **held**, and its run parked without spending budget until
somebody acted. That gate lasted two days.

It failed on the first real repository. The confidence bar has four criteria, and
the third asks that the failure mode now be covered by a test or check that would
have caught it. In `demo-developers-test-15` neither service has a test harness
and the component contract forbids running the app in-session, so the coding
agent declared `low` — correctly, and with its reasoning stated:

> *"neither service has a unit test harness to add a regression check to — so the
> fix has no automated test covering it yet (criterion 3 of the confidence
> checklist). A human should confirm behavior before merge."*

Every incident fix in that repository will say the same thing. A gate that fires
on every case discriminates between none of them: it stopped being a review step
and became a permanent stop, with the build parked behind it.

The instinct that followed — "merge it anyway, but do not close the issue" — is
the right one, and it is what this ADR adopts.

## Decision

**The confidence declaration stops deciding whether an incident fix merges, and
starts deciding whether the issue behind it closes.**

Every incident pull request merges, on the same predicate as everything else.
Then:

- `Confidence: high` → `Resolves #N` closes the issue. Unchanged.
- anything else — `low`, missing, unparseable → the platform **reopens** the
  issue, **removes `aep`**, and comments why.

That issue is now an **unverified fix**: open, on the version's record, visible
to a human, and in no run's working set — the **ledger issue** state the
milestone model already had a name for. The run settles, the build proceeds, and
the doubt stays on the board instead of in a queue.

Safety moves from *a human in front of the merge* to *an open issue behind it*.
Nothing waits for attention; the record simply refuses to claim the incident is
over.

**Everything the hold needed is removed**: `landingHeld`, `landingAbandoned`,
`SigRunPRHeld`, `SigRunPRAbandoned`, `RunPhaseHeld`, the unbounded park, and the
unmerged-close signal that existed only to end it.

## Why the platform reopens instead of not closing

`Resolves #N` does two jobs at once: it is what `decideAutoMerge` matches to know
a pull request is this run's work, and it is what GitHub closes on. Dropping the
keyword to avoid the close would also drop the merge — "resolves no issue" is not
this run's work and is left alone.

The alternative was a second, non-closing keyword the agent writes when its
confidence is low. Rejected: it moves a decision the platform can make
deterministically into the agent's wording, and one `Resolves` written out of
habit closes the issue with nothing to detect it. Reopening keeps the decision in
code, beside the confidence line the merge policy already parses — the same
discipline that forces `dedupeKey` and `adopt` rather than trusting the prompt.

The cost is a close→reopen flicker on the timeline, which the platform's own
comment explains.

It runs on the **merged webhook** rather than beside the merge call, because a
human merging in GitHub reaches only that path — and a fix merged by hand is no
more verified than one merged by the policy.

## Consequences

- **Recurrence became three-way.** "Open" no longer implies someone is working
  it. An issue open *with* `aep` still dedupes (a run owns its dispatch); an
  unverified one continues the same thread — evidence appended, `aep` re-stamped,
  re-homed, dispatched; a closed one reopens as before. Both routes share one
  attempt counter, so escalation still counts across them.
- **The unverified signature is three labels, not two.** The first attempt keyed
  it on "open and not agent work", which describes almost every ordinary issue
  and broke dedupe outright — concurrent alert handlers stopped folding onto one
  issue, the exact duplicate-filing the key exists to prevent. `aep:codingagent`
  records the ACT of adoption and is never removed, so `sre-agent` +
  `aep:codingagent` + no `aep` identifies an issue the platform adopted and then
  deliberately stood down, which only this path does.
- **Label order is load-bearing.** `aep` comes off BEFORE the reopen. The reverse
  briefly presents an open agent-work issue to the dispatch predicate, and a run
  at a cycle boundary in that window dispatches an agent onto an already-merged
  fix.
- **Unverified issues do not accumulate forever.** A human closes one when
  satisfied, and supersede closes any still open when the next version builds —
  with `state_reason: completed`, so a later recurrence lands on the closed
  branch and reopens it. The lifecycle closes rather than leaking.
- **The confidence criteria still matter**, and criterion 3 is now explicitly
  conditional on the project being able to carry a test. The declaration is still
  load-bearing; it just carries a different consequence.
- **A missing declaration reads as low, not as a fault.** Under ADR-0021 it
  failed closed by holding. There is nothing to hold now, and the safe direction
  is the same: an agent that said nothing has told us nothing about its fix, and
  an open issue costs a human a glance where a wrongly closed one costs them the
  incident.
