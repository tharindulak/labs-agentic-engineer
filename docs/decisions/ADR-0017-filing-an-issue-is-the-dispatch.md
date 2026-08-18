# ADR-0017 — Filing an issue is the dispatch

The OpenChoreo SRE/RCA agent's handoff had two steps: `ae_create_issue` filed a
GitHub issue, then `ae_dispatch_coding_agent` asked AEP to work it
(`POST /projects/{p}/tasks/{n}/promote-from-issue` → `PromoteAndExecute` →
`AdoptIssue`). Two calls, and the second was the one that mattered: an issue
created without it is a **ledger issue** — in no milestone, carrying no `aep`
label, invisible to every run's working set. Recorded, and worked by nobody.

That split was load-bearing in a way nobody wanted:

- The second call was an **LLM decision**. The skill told the model to make it;
  a code wrapper (`_wrap_dispatch`) then had to guard the model against calling
  it after a dedupe, and to overwrite the component name the model kept copying
  in prefixed form from issues it had just read.
- The two calls could **come apart**. `AdoptIssue` needs two GitHub writes to
  adopt an issue that already exists — the milestone, then the `aep` label — and
  an issue that survived the first but not the second is filed, in a milestone,
  and still invisible to the run meant to work it. That failure was fixed once
  already (`0f764797`).
- The milestone rework (`c6bf509d`, *"issue-driven execution — the milestone is
  the unit of work"*) had already hollowed the endpoint out. What began as
  "create a Task and dispatch it" was, by the end, a thin wrapper over
  `AdoptIssue` whose `title` and `issueUrl` parameters were accepted and
  ignored.

## Decision

**Adoption belongs to issue creation, and it is the default.**

`create-issue` grows two optional fields — `componentName` and `adopt` (default
**true**) — and one new path in the event plane, `AdoptOnCreate`:

1. Resolve the adoptable milestone (the deployed version, else the spec build in
   flight). DB reads only.
2. `EnsureComponent` when `componentName` was given — a fail-fast, before
   anything is written.
3. File the issue in **one** GitHub call carrying `milestone`, `aep`, and
   `aep:codingagent`.
4. Start the run, or wake the one already parked on that milestone.

`promote-from-issue` is deleted, along with `PromoteAndExecute`, `task.Commands`
(its only method), the `ae_dispatch_coding_agent` MCP tool, and the SRE agent's
dispatch wrapper. `AdoptIssue` stays: the `aep:codingagent` label a human adds
in GitHub is still an adoption route, and the console's dispatch affordance
reaches the same code.

The two routes now share one tail, `startOrWake`, so neither can drift from the
rule that matters most: never two agents on one branch.

## Why the default is `true`

The alternative — adopt only when asked — reproduces the original bug in a new
place. An issue filed through AEP's API with nothing to work it is
indistinguishable, to the caller and to a human reading GitHub, from accepted
work. Making the safe case the silent one is what made the original two-step
handoff fragile.

So silence means dispatch, and a caller that genuinely wants a ledger entry says
`adopt: false`. That preserves the operator's switch (`AE_AUTO_DISPATCH`, which
the SRE agent now applies to the create call in code rather than through its
prompt) without leaving a hole where an unadopted issue can go unnoticed.

The flag is a **pointer** on the generated request type
(`x-go-type-skip-optional-pointer: false`, following `disconnect-git-provider`'s
`uninstall`). Under the repo's global `prefer-skip-optional-pointer` an optional
`bool` renders as a value, and `false` would then be indistinguishable from
absent — inverting the default for every caller that omitted the field.

## Consequences

- **Only the HTTP surface adopts.** The dozen in-process callers of
  `IssueService.CreateIssue` — provision gates, validation, repair, conformance,
  the plan tap, all three mint paths — are untouched, and must stay so: a
  provision gate exists to HOLD dispatch, and `mintRedMainIssue` is deliberately
  never dispatched (*"a red main is a human's call"*).
- **A refusal is answered, not raised.** A project with no version to adopt into
  still gets its issue, as a ledger entry, with the reason returned in
  `adoptionError`. Refusing outright is what once lost handoffs permanently,
  since nothing retries them.
- **Recoverable failures end at the sweep.** Once the issue carries its milestone
  and `aep`, a run that fails to start is not an adoption failure: the reconcile
  sweep's rule is exactly this situation — *a milestone with open work and no
  live run gets one* — so `adopted: true` stays true.
- **A dedupe hit adopts nothing.** The open issue it folded onto was adopted by
  the run that created it, and that run owns its dispatch.
- **The report's dispatch state is now a fact.** `HandoffResult.dispatch_run_name`
  could never be populated — its tool returned only `{"dispatched": true}` — so
  the SRE agent either left it empty after a successful dispatch or invented a
  value, and the console's Alerts LIST serves that snapshot without correlating
  it against live executions. It is replaced by `adopted` / `adoption_error`,
  stamped from what `ae_create_issue` answered rather than restated by the model.
- **A dead marker scheme goes with it.** The handoff stamped `aep:task`,
  `aep:coding`, `aep:origin/incident` and an `<!-- aep:task/v1 -->` body block
  for webhook handlers that no longer exist — `internal/contracts/taskmeta`'s own
  doc says nothing platform-side parses an issue any more. Deleted.
- **One published operation is removed from `api/v1`.** Its only client was
  `aep-mcp-server`, in this monorepo, changed in the same breath.
