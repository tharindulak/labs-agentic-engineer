---
name: issue-fix
description: Write and file the one GitHub issue that hands an RCA root cause to AE's coding agent. Use when an RCA report leaves recommended actions unaddressed and the incident needs a code-level fix filed.
---

# Issue-fix

Your output is one GitHub issue. Filing it is the whole hand-over: AE puts it into
the deployed version's milestone and starts a coding run over it in the same call.
There is no second call for you to make.

You are invoked only when work remains. Whether a recommended action is code-level
or config-level was already decided upstream, by the remediation agent, and is
recorded in each action's `status`: `revised` means it expressed the action as an
OpenChoreo ReleaseBinding change, `suggested` means it could not. You do not
re-decide that, and you do not decide whether the fix is worth making — the coding
agent has the repository and the specification in front of it, and closing an issue
as not planned with its reasoning is a first-class outcome the platform supports by
design.

So the question you answer is not *whether* to file. It is what the issue says.

Whether a coding run actually starts is the OPERATOR's setting, not yours — an
install can be configured to file issues only, and then the issue waits for a
human. Do not assert either way. The call's own answer settles it: `adopted` tells
you what happened.

Deduplication is not yours either. AE derives a stable key from the incident this
request belongs to, so a matching open issue answers `deduped: true` and nothing is
created. Never decide for yourself that an issue you found makes filing
unnecessary; file, and let the answer tell you.

## OBJECTIVES

1. Look for related issues (see RELATED-ISSUE DISCOVERY).
   *Done when* 1-2 keyword queries have run and you have judged each candidate
   related or not. A discovery pass, not the main task.
2. File the issue (see WHAT MAKES A GOOD ISSUE).
   *Done when* an `ae_create_issue` call has returned and the body it carried used
   the heading skeleton, with every heading that applies filled from the report.
3. Say in `rationale` what the call answered and what it means for this incident
   (see WHAT THE FILING CALL ANSWERS).

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
tracked. The platform's own implementation issues ("Implement <component>") record
what was BUILT and what the version's acceptance criteria are, and search marks
them `PlatformRecord: true` with a `ReadAs` note. Treat that flag as binding, and
read such an issue for one purpose: to learn which behaviour must be PRESERVED, so
you can name it under `What must not change`.

A CLOSED match still matters: it signals a recurrence, so the earlier fix did not
hold — say so when you reference it. Closed matches and partial overlaps become
links and do not block filing.

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
  behaviour: one line naming that behaviour, then the change that leaves it
  reachable and unaltered — make a value configurable rather than change it, add
  the handling on the side that lacked it rather than remove the state it failed
  on.
- **An action already handled in configuration** (`status: "revised"`) is
  context, never work. Mention it so the coding agent does not redo it in code:
  "the resource limit was already raised in configuration; the unbounded input
  that exhausts it still needs a fix". You are shown THAT it was handled and
  never the ReleaseBinding change itself, because the coding agent can only edit
  the repository — so ask for code, never for a configuration edit.
- **Spec conflict**, whenever the fix would contradict the specification: name
  the requirement or criterion and say that the platform filed it anyway because
  the requirement may be the thing that is wrong. A requirement nobody is shown
  is a requirement nobody can correct, and the coding agent decides.
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
| `deduped: true` | An earlier run already filed an open issue for this problem; nothing was created. | Report it under `related_issues` and note the dedup. |
| `reopened: true` + `recurrence` | This had already been fixed and closed, and it came back. AE reopened that issue with your evidence appended and re-dispatched it. | Say so plainly, naming the attempt number: a merged fix for this has already failed, which is a different situation from a new bug and may deserve a human rather than another cycle. |
| `suppressed: true` | An issue under this key already carries a no-change verdict: somebody with the repository in front of them already decided this signature needs no code change. Nothing was created. | Report that issue under `related_issues` and say the verdict already answers this incident. Do not file again. |

## TOOL GUIDELINES

- `ae_search_related_issues`: call before filing, scoped to your project.
- `ae_create_issue`: scoped to your project, one call covering all code-level
  actions together. `dedupeKey`, `componentName`, `adopt` and the `sre-agent`
  label are attached for you — that label is what lets a human filter
  `label:sre-agent` project-wide for every issue this system has ever filed,
  independent of the per-component dedupe key.

## CONSTRAINTS

- One RCA report, one issue. Never a second one — not after a dedupe, not after
  an `adoptionError`, not after a failure.
- Creating that issue is your only write: never comment on, close, edit or
  relabel an existing issue.
- If `ae_create_issue` fails, report the failure in `rationale` rather than
  retrying indefinitely. A retry after a partial failure risks a duplicate that
  only the dedupe key can catch.
