---
name: issue-fix
description: Decide whether an RCA root cause needs a code change, and if so file the one GitHub issue that hands it to AE's coding agent. Use when an RCA report leaves recommended actions unaddressed, or names a root cause nothing has been filed for.
---

# Issue-fix

Your output is one judgment — `needs_code_change` — and, when it is true, one
GitHub issue. Filing that issue is the whole hand-over: AE puts it into the
deployed version's milestone and starts a coding run over it in the same call.
There is no second call for you to make.

Whether a coding run actually starts is the OPERATOR's setting, not yours — an
install can be configured to file issues only, and then the issue waits for a
human. Do not assert either way. The call's own answer settles it: `adopted`
tells you what happened, and your system prompt tells you which mode this
deployment runs in.

The handoff is **one-shot**. Nothing retries it: an incident you leave unfiled is
dropped for good, while an unnecessary issue is one a human closes in ten
seconds. Both of your exits are checked against the data you were given, and one
that does not hold up comes straight back to you.

## OBJECTIVES

1. Decide `needs_code_change` (see DECIDING).
   *Done when* every remaining recommended action carries either the change to
   the codebase that would help, or the ruled-out reason that applies to it.
2. When it is true, look for related issues (see RELATED-ISSUE DISCOVERY).
   *Done when* 1-2 keyword queries have run and you have judged each candidate
   related or not. A discovery pass, not the main task.
3. File the issue (see WHAT MAKES A GOOD ISSUE). **Deciding is not the
   deliverable — the issue is.**
   *Done when* an `ae_create_issue` call has returned and the body it carried
   used the heading skeleton, with every heading that applies filled from the
   report — or, when an open issue already covers this problem, when
   `related_issues` names that issue and `rationale` says it covers this.

## DECIDING

Read the root cause first, then `result.recommendations.recommended_actions`.

**Rule out, don't rule in.** You are invoked only when something remained
unaddressed, so filing is the expected outcome: your job is to RULE OUT a code
change, and `needs_code_change = false` is the finding you have to justify.

**A code change is required** when any remaining action names something in the
codebase to change, whatever shape the defect arrived in: a missing guard, an
error value nothing handles, an assumption about a payload or an input, control
flow, retry or timeout behaviour, a resource bound, a panic nobody prevented, the
logging it emits, a dependency, an outright defect — or **hardening** what is
already there, such as making a hardcoded value configurable or adding backoff.
An action with `status: "suggested"` and no `change` object is a strong signal:
the remediation agent could not express it as an OpenChoreo ReleaseBinding
change, which usually means it is not a config problem.

`status` may be absent entirely — the remediation agent did not run, nothing was
triaged for you, and you are deciding from the root cause alone.

### The two ruled-out reasons

A decline is made PER ACTION: one `ruled_out` entry for every remaining
recommended action, each carrying its `index`, the `reason` that applies, and a
`justification` naming what in THAT action makes the reason apply. An action you
cannot map to one of these two reasons is an action that needs a code change.

**`config_handled`** — the action is already actionable as configuration:
`status: "revised"` with a `change` object, which belongs to the remediation
agent. Only ever true of a `revised` action; claiming it for a `suggested` one
asserts a ReleaseBinding change that does not exist.

When such an action sits alongside code-level ones, decide on the code-level ones
and mention the config one in the body as context ("the resource limit was
already raised in configuration; the unbounded input that exhausts it still needs
a fix"). The report
deliberately shows you THAT it was handled, never the ReleaseBinding change
itself, because the coding agent can only edit the repository — so ask for code,
never for a configuration edit.

**`pure_advice`** — the action names nothing to change. No fault behind it:
"consider monitoring this", "review capacity" leaves a coding agent nothing to
edit. This is the subjective half, and the reason you own the decision at all.

Two claims are checkable without a model, and are checked: every remaining action
must be accounted for, and `config_handled` is only true of a `revised` action. A
decline that fails either comes back to you naming the gap.

### The standard: the work is absent, not unwelcome

A `justification` establishes that there is NO WORK. "The system works as
designed" and "it would contradict the spec" are answers to a different question
— whether the work is welcome — and neither is one of the two permitted reasons.

**Deliberate behaviour is usually the fault surface, and the defect is the
handling missing around it.** A specified behaviour is one side of an
interaction; the code that met it is the other. When the interaction fails, what
changes is the side that lacked the handling — and the specified behaviour stays
exactly as specified, and exactly as reachable. Adding that handling leaves the
intent intact, whatever the incident looked like.

So the test is not *"was this behaviour deliberate?"* but *"is there a change to
the code that would help?"*

**A spec conflict is a line in the issue, not grounds to withhold it.** The
criterion may be the thing that is wrong, and a requirement someone got wrong is
only ever discovered through the incident it causes. So when the code correctly
implements a specified behaviour and the fix would contradict that
specification, you FILE and name the requirement or criterion in the body. The
coding agent has the repository and the spec in front of it; closing the issue as
`not_planned` with its reasoning is a first-class outcome the platform supports
by design.

## RELATED-ISSUE DISCOVERY

`ae_search_related_issues` is keyword retrieval: it tokenises your `query` and
returns issues ranked by keyword overlap, with full records (title, body, state,
labels). Pass a handful of **space-separated distinct keywords** — the component
name plus the root-cause symptom terms, `<component> <subsystem> <exception or
failure reason>` — because phrasing varies between issues, so keywords match far
more than a sentence describing the fix you have in mind would. Try 1-2
variations if the first pass surfaces nothing relevant.

If the call itself errors (as distinct from finding nothing), retry once at most,
then proceed to issue creation without related-issue context and say so in
`rationale`.

An issue is related when it plausibly shares the same root cause or the same
affected component — not merely the same repo or a similar word. When unsure,
leave it out: a wrong link confuses the human reviewer more than a missing one.

**Related issues are a ledger, never a spec.** They tell you what is already
tracked and say nothing about whether a code change is warranted. The platform's
own implementation issues ("Implement <component>") record what was BUILT and what
the version's acceptance criteria are, and search marks them `PlatformRecord:
true` with a `ReadAs` note. Treat that flag as binding: read such an issue to
learn which behaviour must be PRESERVED.

A CLOSED match still matters: it signals a recurrence, so the earlier fix did not
hold — say so when you reference it. Closed matches and partial overlaps become
links and do not block filing.

A clearly matching OPEN issue is different: it is already the handoff for this
problem. Leave `needs_code_change` true — the work is real and tracked — report
that issue under `related_issues`, say in `rationale` that it covers this, and
file nothing.

## WHAT MAKES A GOOD ISSUE

- **Title**: the component, the site and the problem — the handler or function
  plus what goes wrong there ("Add structured error logging for upstream failures
  in `payment-service`", "Handle the unmapped response case in `report-api`'s
  summary handler").
- **Body**: these headings, in this order, dropping only the ones that do not
  apply. Everything under them comes from the RCA report.

      ## RCA summary
      ## Root cause
      ## What must not change
      ## Spec conflict
      ## Before you change a default
      ## Evidence
      ## Related issues

  The coding agent reads this body, so a fixed shape is what lets it find the
  constraint and the criteria step every time.

- **Related issues**: one line each as `- #N — <one-line reason>` (`- #12 — same
  root cause in the same handler, fixed by PR #13 but recurring`). Take each `#N`
  from the search results rather than from memory: those mentions ARE the
  cross-link — GitHub turns each into a clickable reference and adds a
  "mentioned" event on the other issue's timeline, which is why you never comment
  on other issues yourself.
- **Evidence**: the links/IDs of traces or log excerpts already in the report.
- **Before you change a default**: tell the agent to read
  `specs/validation/validation-criteria.json` and list the criteria its change
  could affect, and to close the issue as not planned naming the criterion if any
  would fail. A step with an output; prose alone has already failed — an issue
  carrying "preserve every current default" still got a fix that moved a default
  anyway and failed criteria that had been passing. Say which values matter only
  by pointing at the criteria file: the kinds that mattered in the last incident
  are the wrong ones for the next.
- **What must not change**, whenever the root cause involves deliberate
  behaviour (the standard argued under DECIDING): one line naming that behaviour,
  then the change that leaves it reachable and unaltered — make a value
  configurable rather than change it, add the handling on the side that lacked it
  rather than remove the state it failed on.
- **Spec conflict**, whenever the fix would contradict the specification (see
  DECIDING): name the requirement or criterion, say the platform filed it anyway
  because the requirement may be wrong, and leave the judgment to the coding
  agent.
- Describe the problem and the desired outcome rather than a code diff; the
  coding agent designs the implementation.

## WHAT THE FILING CALL ANSWERS

The answer changes what you do next, and what you do belongs in `rationale`. The
issue number, `deduped` and `adopted` are recorded from the call itself, so
`rationale` carries the consequence rather than the values.

| Answer | What happened | What `rationale` says |
|---|---|---|
| `adopted: true` | Filed, and a coding run has it. The normal outcome when this install hands over. | Nothing further. |
| `adopted: false` with no `adoptionError` | Filed, and nothing was asked to work it — this install files issues only. | Say the issue waits for a human to pick it up. |
| `adopted: false` + `adoptionError` | The issue exists but nothing will work it yet, usually because the project has no built version to adopt an incident into. | Quote the `adoptionError`, so the human knows the issue waits for someone to pick it up. |
| `deduped: true` | An earlier run already filed an open issue for this problem; nothing was created. | Report it under `related_issues` and note the dedup — the matching-OPEN-issue case above. |
| `reopened: true` + `recurrence` | This had already been fixed and closed, and it came back. AE reopened that issue with your evidence appended and re-dispatched it. | Say so plainly, naming the attempt number: a merged fix for this has already failed, which is a different situation from a new bug and may deserve a human rather than another cycle. |

## TOOL GUIDELINES

- `ae_search_related_issues`: call before filing, scoped to your project.
- `ae_create_issue`: scoped to your project, one call covering all code-level
  actions together. `dedupeKey`, `componentName`, `adopt` and the `sre-agent`
  label are attached for you — that label is what lets a human filter
  `label:sre-agent` project-wide for every issue this system has ever filed,
  independent of the per-component dedupe key.
- Declining needs no tool call. Carry the same per-action mapping into the
  report's `## Ruled out` section, so the judgment is persisted with the
  diagnosis rather than only checked in passing.

## CONSTRAINTS

- One RCA report, one issue. Never a second one — not after a dedupe, not after
  an `adoptionError`, not after a failure.
- Creating that issue is your only write: never comment on, close, edit or
  relabel an existing issue.
- If `ae_create_issue` fails, report the failure in `rationale` rather than
  retrying indefinitely. A retry after a partial failure risks a duplicate that
  only the dedupe key can catch.
