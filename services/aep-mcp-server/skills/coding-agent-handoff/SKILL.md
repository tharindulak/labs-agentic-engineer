---
name: coding-agent-handoff
description: Use when a completed RCA report needs a source-code change — how to search related issues and file the one issue that hands it to AE's coding agent.
---

# Coding agent handoff

**Audience: the SRE agent's handoff stage.** You are the last step of an RCA run,
and this incident needs a change to the REPOSITORY.

Your output is one GitHub issue. Filing it is the whole hand-over — once the issue
is created, AE decides what to do with it. There is no second call for you to make.

Most of this incident is already **settled** — the classification, the dedupe
key and the tracking policy after creation. One thing is **yours**: the words of
the issue, and the `componentName` you pass.

## WHY YOU ARE HERE

The stage that runs you already classified this incident as needing code —
`code_level` (configuration addressed none of it) or `mixed` (some of it).
It comes from the remediation agent's verdict on each action, in the `status`:

| `status` | What it means | What it is to you |
|---|---|---|
| `revised` | expressed as an OpenChoreo ReleaseBinding change | context, never work |
| `suggested` | remediation could not express it as config | the code-level work |
| absent | the remediation agent never ran at all | write from the root cause alone |

The classification is settled. So is the worth of the fix, which the coding agent
settles with the repository and the specification in front of it — closing an
issue as not planned with its reasoning is a first-class outcome.

**Any code this report suspects is handed over.** A low-confidence root cause
carrying a code-level action is still a code-level action, never a reason to
withhold it. Every report that reaches this stage produces an issue — what it
withholds is never yours to decide.

## THE FLOW

1. **Search** for related issues.
   *Done when* 1-2 keyword queries have run and you have judged each candidate
   related or not. A discovery pass, not the main task.
2. **File** the one issue — including when step 1 found a match, for the reason
   in DEDUPLICATION.
   *Done when* an `ae_create_issue` call has returned and the body it carried
   used the heading skeleton, with every heading that applies filled from the
   report. This is your last step: filing the issue is the whole hand-over,
   and nothing after it is reported anywhere.

## RELATED-ISSUE DISCOVERY

Pass a handful of **space-separated distinct keywords** — the component name plus
the root-cause symptom terms, `<component> <subsystem> <exception or failure
reason>`. Try 1-2 variations if the first pass surfaces nothing relevant. If the
call itself errors (as distinct from finding nothing), retry once at most, then
file without related-issue context rather than retry a second time.

An issue is related when it plausibly shares the same root cause or the same
affected component — not merely the same repo or a similar word. When unsure,
leave it out: a wrong link confuses the human reviewer more than a missing one.
Closed matches and partial overlaps become links.

**Related issues are a ledger, never a spec.** The platform's own implementation
issues ("Implement <component>") record what was BUILT, and search marks them
`PlatformRecord: true` with a `ReadAs` note. Treat that flag as binding, and
read such an issue for the thing it is your only source of: which behaviour
must be PRESERVED, for `What must not change`.

A CLOSED match still matters: it signals a recurrence, so the earlier fix did not
hold — say so when you reference it.

## WHAT MAKES A GOOD ISSUE

**Title** — the component, the site and the problem: the handler or function plus
what goes wrong there ("Add structured error logging for upstream failures in
`payment-service`", "Handle the unmapped response case in `report-api`'s summary
handler").

**Body** — this skeleton, in this order, dropping only the headings that do not
apply:

      ## RCA summary
      ## Root cause
      ## What must not change
      ## Evidence
      ## Related issues

The coding agent reads this body, so a fixed shape is what lets it find the
constraint every time. Everything under the headings comes from the RCA report.

### What fills each heading

- **What must not change**, whenever the root cause involves deliberate
  behaviour: one line naming that behaviour, then the change that leaves it
  reachable and unaltered — make a value configurable rather than change it, add
  the handling on the side that lacked it rather than remove the state it failed
  on.
- **Evidence**: carry across what the report already collected — trace links or
  IDs, and the log lines it quoted.
- **Related issues**: one line each as `- #N — <one-line reason>` (`- #12 — same
  root cause in the same handler, fixed by PR #13 but recurring`). Take each `#N`
  from the search results rather than from memory: those mentions ARE the
  cross-link — GitHub turns each into a clickable reference and adds a
  "mentioned" event on the other issue's timeline.

### Throughout

- Describe the problem and the desired outcome rather than a code diff; the
  coding agent designs the implementation.
- Mention each `revised` action, so the coding agent does not redo in code what
  configuration already handled: "the resource limit was already raised in
  configuration; the unbounded input that exhausts it still needs a fix". You are
  shown THAT it was handled and never the ReleaseBinding change itself, because
  the coding agent can only edit the repository — so ask for code.

## DEDUPLICATION

Deduplication is settled server-side. AE derives a stable key from the incident
this request belongs to, from the identity headers the run carries. That key is
not an argument you can pass and not a value you can spell, so the only way to
learn what it already covers is to file.

**File; the create call's answer decides dedupe, not your search.** A search hit
is a discovery signal, not the verdict: your judgement of "related" is looser
than the key, and the key sees closed issues, no-change verdicts and
recurrences that a keyword match cannot tell apart. An issue that already
covers this incident is settled by the platform, not by you writing on it.

- **Evidence attaches itself.** On a recurrence the platform appends your
  evidence into the issue's own body, not as a comment — a comment can be
  skipped past, a body section cannot. Where it lands is settled; writing it into
  the body you file is yours.
- **`componentName` is yours to get right.** The key is derived, but this
  argument feeds it, and when the calling process has no identity for this
  incident your value is the only thing that produces a key at all. A wrong one
  dedupes against the wrong history.
- **The tracking labels are settled.** `bug` and `sre-agent` are added to every
  issue you file, on top of any `labels` you pass. `sre-agent` is what lets
  a human filter for every issue this system has ever filed, independent of the
  per-component dedupe key.

## CONSTRAINTS

- **One RCA report, one issue.** One `ae_create_issue` call is the whole write
  you make. A retry after a partial failure risks a duplicate that only the
  dedupe key can catch.
- **Creating that issue is your only write.** Every other issue in this run is
  one you read; the `#N` mentions in your body are the only mark you leave on
  them.
