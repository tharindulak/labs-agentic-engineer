---
name: issue-fix
description: Decide whether an RCA root cause needs a code change, and if so file the one GitHub issue that hands it to AE's coding agent.
---

# Issue-fix

Your output is one judgment — `needs_code_change` — and one call that records it:
`ae_create_issue` when it is true, `ae_decline_issue` when it is false. Filing an
issue IS the handoff: AE puts it into the deployed version's milestone and starts
a coding run over it in the same call. Declining is not free — it must justify
itself, and the call refuses one that does not.

## OBJECTIVES

1. Decide `needs_code_change` (see DECIDING).
   *Done when* you can name the specific change to the codebase that would help,
   or name which of the two ruled-out cases this is — and, for every remaining
   action, the hardening change you considered and why it contradicts the spec.
2. When it is true, look for related issues (see RELATED-ISSUE DISCOVERY).
   *Done when* 1-2 keyword queries have run and you have judged each candidate
   related or not. A discovery pass, not the main task.
3. File the issue (see WHAT MAKES A GOOD ISSUE). **Deciding is not the
   deliverable — the issue is.** If you concluded a code change is needed and
   your turn ends without an `ae_create_issue` call, nothing was handed over and
   the incident is dropped; that is checked, and it comes straight back to you.
   *Done when* the body carries the RCA summary, the motivating root cause(s),
   the relevant recommended action(s), a `## Related issues` section if you found
   any, and — where the behaviour is deliberate — the line saying what must be
   preserved.

## DECIDING

Read the root cause first, then `result.recommendations.recommended_actions`.

**Rule out, don't rule in.** You are invoked only when something remained
unaddressed, so filing is the expected outcome: your job is to RULE OUT a code
change, and `needs_code_change = false` is the finding you have to justify. An
unfiled defect is dropped for good — nothing retries a handoff — while an
unnecessary issue is one a human closes in ten seconds.

**A code change is required** when any remaining action names something in the
codebase to change: logic, error handling, retry or timeout behaviour, the
logging it emits, a dependency, an outright defect — or **hardening** what is
already there, such as making a hardcoded value configurable or adding backoff.
An action with `status: "suggested"` and no `change` object is a strong signal:
the remediation agent could not express it as an OpenChoreo ReleaseBinding
change, which usually means it is not a config problem.

`status` may be absent entirely — the remediation agent did not run, nothing was
triaged for you, and you are deciding from the root cause alone.

**Ruled out** in exactly two cases, and ruling out is a CALL, not a silent
ending: `ae_decline_issue` carries one `ruledOut` entry PER remaining action,
each naming which of the two cases applies, why it applies to that action, and —
in `hardeningRuledOut` — the hardening change you considered and why applying it
would contradict the spec. An action you cannot map to one of the two cases is an
action that needs a code change. The mapping is checked by that call: a decline
that does not account for every action, or whose justification only asserts the
behaviour was deliberate, is REFUSED with its reasons and comes straight back to
you. Fix it or file the issue.

If your turn ends with neither an `ae_create_issue` nor an `ae_decline_issue`
call, nothing was handed over and nothing was ruled out — the incident is simply
dropped, and nothing retries a handoff. The two cases:

- Every remaining action is already actionable as configuration: `status:
  "revised"` with a `change` object, which belongs to the remediation agent. When
  such an action sits alongside code-level ones, decide on the code-level ones
  and mention the config one in the body only as context ("the timeout was
  already raised in configuration; the retry loop still needs a fix"). The report
  deliberately shows you THAT it was handled, never the ReleaseBinding change
  itself, because the coding agent can only edit the repository — so ask for
  code, never for a configuration edit.
- No remaining action names anything to change. Pure advice with no fault behind
  it — "consider monitoring this", "review capacity" — leaves a coding agent
  nothing to edit.

### As-designed behaviour can still be hardened

The likeliest way to get this wrong is to read "the system is behaving as
designed" as "there is nothing to fix". Those are different claims.

A deliberate 8-second delay that trips a 5-second timeout IS intended — and
"make the delay configurable" and "add retry with backoff" are hardening changes
that leave the intent completely intact. The test is not *"was this behaviour
deliberate?"* but *"is there a change to the code that would help and that does
not contradict the spec?"* If yes, file it, and say which behaviour must be
preserved.

This is why `hardeningRuledOut` is required on every decline entry: naming the
hardening change you considered forces the real test to be answered instead of
substituted. "It is intended behaviour" fills the field with the wrong answer and
`ae_decline_issue` refuses it. If the hardening change you name would NOT
contradict the spec, you have just found the issue to file.

## RELATED-ISSUE DISCOVERY

`ae_search_related_issues` is keyword retrieval: it tokenises your `query` and
returns issues ranked by keyword overlap, with full records (title, body, state,
labels). Pass a handful of **space-separated distinct keywords** — the component
name plus the root-cause symptom terms (`service1 service2 timeout`, `payment
OOMKilled memory`) — because phrasing varies between issues, so keywords match
far more than a sentence like "make service1 timeout configurable" would. Try
1-2 variations if the first pass surfaces nothing relevant.

If the call itself errors (as distinct from finding nothing), retry once at most,
then proceed to issue creation without related-issue context and say so in
`rationale`.

An issue is related when it plausibly shares the same root cause or the same
affected component — not merely the same repo or a similar word. When unsure,
leave it out: a wrong link confuses the human reviewer more than a missing one.

Search results mark AE's own planned-work issues with `PlatformRecord: true`
and a `ReadAs` note. Treat that flag as binding: such an issue tells you what to
PRESERVE, never that a change is unwarranted.

**Related issues are a ledger, never a spec.** They tell you what is already
tracked and say nothing about whether a code change is warranted. The platform's
own implementation issues ("Implement service1") record what was BUILT and what
the version's acceptance criteria are — read them to learn which behaviour must
be preserved, never as grounds for ruling a change out.

A CLOSED match still matters: it signals a recurrence, so the earlier fix did not
hold — say so when you reference it. Closed matches and partial overlaps become
links and do not block filing.

A clearly matching OPEN issue is different: it is already the handoff for this
problem. Leave `needs_code_change` true — the work is real and tracked — report
that issue under `related_issues`, say in `rationale` that it covers this, and
file nothing.

## WHAT MAKES A GOOD ISSUE

- **Title**: names the component and the problem ("Add structured error logging
  for timeout failures in `payment-service`").
- **Body**: the RCA summary, the root cause(s) that motivate a code change, the
  relevant recommended action(s), and links/IDs to traces or log excerpts already
  present in the report. Nothing that is not in the RCA report.
- **Related issues section**: end the body with `## Related issues`, one line
  each as `- #N — <one-line reason>` (`- #12 — same timeout root cause, fixed by
  PR #13 but recurring`). Those `#N` mentions ARE the cross-link — GitHub turns
  each into a clickable reference and adds a "mentioned" event on the other
  issue's timeline, which is why you never comment on other issues yourself. Get
  the numbers right.
- **What must not change**, whenever the root cause involves deliberate
  behaviour: one line, e.g. "the ~8s delay in `service2` is intended and must
  remain the default; make it configurable rather than shorter". The coding agent
  works from this issue alone and will otherwise "fix" exactly what the version's
  acceptance criteria require — and the platform's own validation then fails the
  version.
- Describe the problem and the desired outcome rather than a code diff; the
  coding agent designs the implementation.

## TOOL GUIDELINES

- `ae_search_related_issues`: call before filing, scoped to your project.
- `ae_decline_issue`: the terminal call when `needs_code_change` is false. One
  `ruledOut` entry per remaining action; a decline that skips an action, stubs a
  field, or rests on "it is intended" is refused with its reasons. Carry the same
  `ruledOut` into the report's `## Ruled out` section so the judgment is
  persisted with the diagnosis, not just checked in passing.
- `ae_create_issue`: scoped to your project, covering all code-level actions
  together. `dedupeKey`, `componentName`, `adopt` and the `sre-agent` label are
  attached for you — that label is what lets a human filter `label:sre-agent`
  project-wide for every issue this system has ever filed, independent of the
  per-component dedupe key.
- What `ae_create_issue` ANSWERS changes what you do next and belongs in
  `rationale`. You never restate the values — the issue number, `deduped` and
  `adopted` are recorded from the call itself:
  - `adopted: true` — filed, and a coding run has it. The normal outcome.
  - `adopted: false` with an `adoptionError` — the issue exists but nothing will
    work it yet, usually because the project has no built version to adopt an
    incident into. Quote the `adoptionError`, so the human reading the report
    knows the issue is waiting for someone to pick it up.
  - `deduped: true` — an earlier run already filed an open issue for this problem
    and nothing was created. Handle it exactly like the matching-OPEN-issue case
    above: report it under `related_issues` and note the dedup.
  - `reopened: true` with a `recurrence` count — this incident had already been
    fixed and closed, and it came back. AE reopened that same issue with your
    evidence appended and handed it to the coding agent again. Say so plainly in
    `rationale`, naming the attempt number: a reader needs to know a merged fix
    for this has already failed, because that is a different situation from a
    new bug and may deserve a human rather than another cycle.

## CONSTRAINTS

- One RCA report, one issue. Never a second one — not after a dedupe, not after
  an `adoptionError`, not after a failure.
- Creating that issue is your only write: never comment on, close, edit or
  relabel an existing issue.
- If `ae_create_issue` fails, report the failure in `rationale` rather than
  retrying indefinitely. A retry after a partial failure risks a duplicate that
  only the dedupe key can catch.
