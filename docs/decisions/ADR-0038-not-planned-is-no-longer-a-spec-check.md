# ADR-0038 — `not_planned` is no longer a spec check

ADR-0034 gave the coding agent one way to end a cycle without a code change:
when `specs/` actively **requires** the exact behaviour an alert fires on (a
demo specified to time out, a required error log), close the issue as
`not_planned`, citing the acceptance criteria that mandate it.

In practice the check drifted from what it was written to catch. On a live
incident (`wso2-tharindu-SF/test-zero#6`), the coding agent closed a
`DivisionByZero` panic as `not_planned` on the strength of the PRD calling the
empty-catalog response *"deliberately unspecified"* — a gap, not a mandate —
and its own investigation found no acceptance criterion covering the case at
all. `specs/` leaving something unspecified is not `specs/` requiring the
behaviour that resulted; the skill's own citation requirement should have
blocked exactly this close, and didn't, because satisfying it was left to the
agent's own judgement rather than enforced.

Narrowing the check (requiring the citation as a hard gate, or naming a
separate category for "not reproducible") was considered and rejected: it
keeps a coding agent in the business of deciding whether a spec **excuses** a
defect, for every issue, incident or not. That judgement call is exactly what
kept producing the wrong answer.

## Decision

**The coding agent no longer closes an issue as `not_planned` on any spec
ground.** `skills/aep/SKILL.md`'s "When no code change can resolve an issue"
section is removed, and `gh issue close` — with or without a reason — is back
on the "Never" list unconditionally, alongside `gh pr close` and `gh pr
merge`. A component-contract conflict is handled the way every other one
already is: implement what the issue asks, and say so in one line
(`references/component-contract.md`'s existing rule, untouched).

`not_planned` itself is not removed — it is GitHub's own vocabulary, and
AEP's server-side handling of it (ADR-0032's never-reopen-on-`not_planned`
rule, ADR-0034's `cycleNoWork`, dedupe suppression) stays exactly as built. A
human closing an issue as `not_planned` through the GitHub UI is unaffected
and still respected everywhere it is checked. What is removed is the coding
agent's own authority to reach that verdict.

## Consequences

- **ADR-0034's original failure mode can recur, deliberately.** An agent that
  concludes a cycle's work is genuinely impossible — the spec truly does
  mandate the behaviour an alert flags — now has no way to say so. It leaves
  the issue open with a diagnostic, the run waits out `cycleLandingTimeout`,
  redispatches, and a second agent reaching the same conclusion ends the run
  at `redispatch-budget` — the ~4-hour path ADR-0034 was written to close.
  Accepted: a coding agent that is *right* but stuck for four hours costs less
  than one that is *wrong* and closes a live incident.
- **Every incident gets a fix attempt.** Nothing short-circuits an sre-agent
  issue before the coding agent has actually tried to address it in code.
- **If the ADR-0034 case recurs in practice** — a genuinely spec-mandated
  alert, correctly identified, with nowhere to go — that is the signal to
  revisit this decision, this time with the citation enforced as a hard gate
  rather than left to convention.

## Related

- [ADR-0034](./ADR-0034-a-cycle-can-end-because-no-code-change-is-possible.md)
  — introduced the mechanism this ADR removes from the coding agent's own
  authority.
- [ADR-0032](./ADR-0032-a-merged-fix-is-not-a-resolved-incident.md) — the
  server-side `not_planned` handling this ADR leaves untouched.
