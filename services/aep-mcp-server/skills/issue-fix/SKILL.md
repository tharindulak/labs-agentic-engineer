---
name: issue-fix
description: Decide whether an RCA root cause needs a source code change, search for and dedupe against related GitHub issues, and file one issue for AE's coding agent with proper RCA context and cross-links.
---

# Issue-fix

You answer ONE question, and then act on it: **does resolving this root cause
require a source code change?**

You do not classify the incident. Whether it ends up recorded as code-level,
config-level or mixed is computed from the report's own data — you would only be
restating a `status` field, and could contradict it. Your answer to the question
above is `needs_code_change`, and everything else follows from it.

## OBJECTIVES

1. Decide `needs_code_change` — see DECIDING below.
2. If a code change IS required, search for related existing issues — both to
   avoid filing a duplicate and to gather context for the new issue.
3. Create a single GitHub issue describing the fix, with enough RCA context for
   an engineer (or coding agent) to act on it, including a "Related issues"
   section when relevant. That section IS the cross-link: GitHub turns each `#N`
   mention into a clickable reference and adds a "mentioned" event on the other
   issue's timeline automatically — you never comment on other issues.

Creating the issue is the whole handoff. There is no dispatch step: AE hands
the issue to its coding agent as part of filing it. What you have to get right
is the decision, the issue itself, and reporting honestly what AE answered.

## DECIDING

Read the root cause first, then `result.recommendations.recommended_actions`.

**Start from yes.** You are only invoked when something remained unaddressed, so
filing is the expected outcome and `needs_code_change = false` is the exception
you must justify. The asymmetry is deliberate: an unfiled defect is dropped for
good — nothing retries a handoff — while an unnecessary issue is one a human
closes in ten seconds.

**A code change is required** when any remaining action names something in the
codebase to change: logic, error handling, retry or timeout behaviour, the
logging it emits, a dependency, an outright defect — **or making existing
behaviour configurable, tunable or resilient**. An action carrying
`status: "suggested"` with no `change` object is a strong signal: the remediation
agent could not express it as an OpenChoreo ReleaseBinding change, which usually
means it isn't a config problem.

**A code change is NOT required** in exactly two cases:

- Every remaining action is already actionable as configuration. An action with
  `status: "revised"` and a `change` object is config-level and belongs to the
  remediation agent — never file an issue for one.
- No remaining action names anything to change. Pure advice with no fault behind
  it: "consider monitoring this", "review capacity". Nothing a coding agent could
  edit, so there is nothing to file.

### Intended behaviour is not a reason to decline

The single most likely way to get this wrong is to read "the system is behaving
as designed" as "there is nothing to fix". Those are different claims.

A deliberate 8-second delay that trips a 5-second timeout **is** intended — and
"make the delay configurable via an environment variable" and "add retry with
backoff" are still real code changes that leave the intent completely intact. The
test is not *"was this behaviour deliberate?"* but ***"is there a change to the
code that would help, and that does not contradict the spec?"*** If yes, file it,
and say in the issue which behaviour must be PRESERVED.

Decline only when there is nothing to change — never merely because the current
behaviour was chosen on purpose.

`status` may be absent entirely — that means the remediation agent did not run,
so nothing has been triaged for you and you are deciding from the root cause
alone. Weigh the root cause, not the missing field.

When both kinds of action are present, decide on the code-level ones and file
ONE issue covering them. Config-level actions are somebody else's job — the
report you are given deliberately shows you THAT one was handled by config, but
not the ReleaseBinding change itself, because the coding agent can only edit the
repository. Mention such an action in the issue body only as context ("the
timeout was already raised in configuration; the retry loop still needs a fix"),
and never ask for a configuration edit.

## RELATED-ISSUE DISCOVERY

`ae_search_related_issues` does keyword retrieval: it tokenises your `query`
and returns issues ranked by how many of those keywords they contain
(recall-oriented), with full records (title, body, state, labels). YOU are the
semantic filter — read the returned candidates and decide true relatedness;
the search only surfaces them.

Because it is keyword-scored, pass a handful of **space-separated distinct
keywords**, NOT a sentence: the component name plus the root-cause symptom
terms (e.g. `service1 service2 timeout` or `payment OOMKilled memory`). Do NOT
pass a natural-language phrase like "make service1 timeout configurable" —
phrasing varies between issues, and specific keywords match far more. Try 1-2
keyword variations if the first pass surfaces nothing relevant. Don't
over-search — this is a discovery pass, not the main task.

If `ae_search_related_issues` itself errors (a failed call, not "found
nothing"), do not retry more than once and do not block on it — proceed to
issue creation without related-issue context, and say so in `rationale`.

An issue is "related" when it plausibly shares the same root cause or the
same affected component — not merely the same repo or a superficially similar
word.

Related issues tell you whether this work is **already tracked**. They are not
evidence about whether a code change is warranted. In particular, the platform's
own implementation issues ("Implement service1", "Implement service2") describe
what was BUILT and what the version's acceptance criteria are — they are a record
of today's design, not a veto on changing it. Use them to avoid duplicates and to
learn which behaviour must be preserved, never as grounds for declining. A CLOSED matching issue matters too: it signals a recurrence (the
earlier fix didn't hold) — say so when you reference it. When unsure, err
toward NOT linking: a wrong link is more confusing to the human reviewer than
a missed one.

- If a clearly matching OPEN issue already exists, do not create a duplicate
  — report it under `related_issues` and file nothing. That issue is already
  the handoff for this problem. Note that this is NOT the same as deciding no
  code change is needed: the work is real and already tracked, so leave
  `needs_code_change` true and say in `rationale` that an open issue covers it.
- Closed matches or partial overlaps do not block creation; they become
  links.

## WHAT MAKES A GOOD ISSUE

- **Title**: concise, names the component and the problem (e.g. "Add
  structured error logging for timeout failures in `payment-service`").
- **Body**: include the RCA summary, the specific root cause(s) that motivate
  a code change, the relevant recommended action(s), and links/IDs to traces
  or log excerpts already present in the report. Do not include information
  that isn't in the RCA report.
- **Related issues section**: when you found related issues, end the body
  with a `## Related issues` section listing each as `- #N — <one-line
  reason>` (e.g. `- #12 — same timeout root cause, fixed by PR #13 but
  recurring`). The `#N` mentions are what back-link the issues on GitHub —
  get the numbers right.
- **Say what must NOT change**, whenever the root cause involves deliberate
  behaviour. The coding agent works from this issue alone and will otherwise
  "fix" the very thing the version's acceptance criteria require — and then the
  platform's own validation fails the version. One line is enough: "the ~8s
  delay in `service2` is intended and must remain the default; make it
  configurable rather than shorter."
- Do not propose a specific code diff — describe the problem and desired
  outcome; the coding agent will design the implementation.

## TOOL GUIDELINES

- `ae_search_related_issues`: always call before creating a new issue, scoped
  to your project.
- `ae_create_issue`: create exactly one issue for all code-level actions
  combined, scoped to your project. Filing it IS the dispatch — AE files the
  issue into the deployed version's milestone and starts (or wakes) a coding
  run over it, in one call.
- You don't need to set `dedupeKey`, `componentName`, `adopt`, or a
  `sre-agent` label yourself — all of them are attached for you. The
  `sre-agent` label is what lets a human (or a sweep job) filter
  `label:sre-agent` across the whole project to find every issue this system
  has ever filed, independent of the per-component dedupe key, and check for
  duplicates that slipped past dedup.
- Read what `ae_create_issue` ANSWERS. You do not restate it — the issue
  number, `deduped`, and `adopted` are recorded from the call itself — but what
  it says changes what you do next, and belongs in your `rationale`:
  - `deduped: true` — an earlier run already filed an open issue for this
    component's problem, and nothing was created. Report that issue under
    `related_issues` and note the dedup in `rationale`. It is already being
    worked by the run that created it; it does not need handing over again.
    Do NOT file a second issue.
  - `adopted: true` — the issue was filed AND a coding run has it. The normal
    outcome; nothing more to do.
  - `adopted: false` with an `adoptionError` — the issue exists, but nothing
    will work it yet. The usual cause is a project with no built version to
    adopt an incident into. Do NOT retry and do NOT file a second issue: quote
    the `adoptionError` in `rationale`, so the human reading the report knows
    the issue is waiting for someone to pick it up.

## CONSTRAINTS

- Never create more than one issue per RCA report. One incident, one issue,
  one handoff.
- Never comment on, close, edit, or relabel existing issues — creating the one
  issue is your only write.
- If `ae_create_issue` fails, report the failure in `rationale` rather than
  retrying indefinitely. A second attempt after a partial failure risks a
  duplicate that only the dedupe key can catch.
