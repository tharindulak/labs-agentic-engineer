# ADR-0025 — Incident identity is transport-carried

`ae_create_issue` used to accept `dedupeKey`, `componentName` and `adopt` as
tool arguments, filled in by the SRE agent's model from whatever it read off
the RCA report. That put three decisions that matter to production inside a
prompt: which incident this is, which dedupe namespace it files under, and
whether a coding agent starts against the fix automatically. A model that
paraphrases the component name, or invents a dedupe key from the wrong field,
files a valid-looking sibling issue with nothing downstream able to tell it
apart from the real one.

The project, the component and the error signature are facts about the alert,
not about the call. AE can confirm that a component named in a request exists
in a project's design, but it cannot confirm that this is the component the
alert actually fired on — that link exists only in the calling process, which
read the alert. Likewise AE verifies the org a caller's bearer token is scoped
to, but it does not verify the project; a project name is just a string the
caller supplies. Neither of those checks makes a model-chosen name reliable
enough to key a dedupe namespace on.

## Decision

**Incident identity travels as per-run HTTP headers, out of the model's
reach, and wins over anything the tool call argues for.** `X-AEP-Incident-Project`,
`X-AEP-Incident-Component` and `X-AEP-Incident-Signature` are set by the
calling process — the SRE agent's harness, not its model — for every call in
a run. `handoffContext.ts` reads them, validates their shape, and overrides
whatever `ae_create_issue`'s arguments said. A caller that cannot spell a tool
argument can no longer misfile an incident; the identity is not in its
vocabulary to get wrong.

**The dedupe key format, the label set and adoption are AEP's own contract,
derived server-side, not accepted as input.** Given a component and an
optional signature, `resolveHandoff` builds `sre-rca/<component>` or
`sre-rca/<component>/<signature>`; every issue gets `bug` and `sre-agent`
appended to its labels; and whether the issue is adopted comes from this
server's own `AEP_HANDOFF_ADOPT` configuration, not from a tool argument
named `adopt`. That last one is deliberate for a reason distinct from the
identity argument: `adopt` was a flag, and a flag an LLM can populate in a
tool call is a policy an LLM can flip. Adoption decides whether a coding
agent starts running against production code with no human in the loop
first; that decision belongs to whoever operates this server, expressed once
as deployment configuration, not to whatever the model decided to pass on a
given call.

**The `sre-agent` label is load-bearing, not decoration.** aep-api's
recurrence lookup (`internal/sourcecontrol/issue_service.go:293`) queries
GitHub for candidates with the dedupe label AND `LabelSREAgent` together. An
issue filed without that label does not fail to file — it simply drops out of
recurrence detection, so the next occurrence of the same incident reads as a
first filing instead of a recurrence. `HANDOFF_LABELS` in
`handoffContext.ts` is the one copy of that label TypeScript cannot import
from Go, so it is pinned against `LabelSREAgent` by a dedicated test rather
than left to stay in sync by convention.

The descriptor mounted into the SRE agent's ConfigMap
(`services/aep-mcp-server/handoff/provider.json`) reflects this: its
`forced_args` block and standalone `labels` array are gone, replaced by an
`incident_headers` section naming the three headers by their wire names. The
agent no longer has fields to populate for any of this; it has headers to
set once per run.

## Known gaps, carried forward

This design accepts four gaps rather than closing them here, each recorded so
none of them is later mistaken for an oversight nobody knew about.

The **not-planned verdict has nowhere to land on the report row.** Today,
declining to act is reasoning attached to the RCA report itself, visible
beside the diagnosis in the console. Under this design, that reasoning
becomes the coding agent's closing comment on the GitHub issue instead — the
report says only that an issue was filed, and there is a window where the
issue is open with no verdict yet. Writing the verdict back onto the report
row when a coding agent closes an issue as not planned is event-plane work
for a later change.

**`escalate.go` becomes a quiet backstop, not dead code.** It only fires when
the stage errored or ended its turn without filing, which under normal
operation is rare. That rarity is the point, not a defect: its logs staying
quiet is what a working backstop looks like, and quiet logs must not later be
read as evidence the path is unreachable and safe to delete.

**`splitActions` still drops an action with an absent status.** The SRE
predicate now treats an absent status as pending on the normal path, but
`splitActions` recognizes only `suggested` as code-level and silently drops
anything else — including no status at all. That means a report whose
actions carry no status escalates nothing through the backstop either, which
is exactly the report that most needed the backstop to catch it. Aligning
`splitActions` to treat an absent status as code-level is tracked, not done
here.

**Soft recommended actions now reach the coding agent.** Removing the
`adopt` veto also removed the `pure_advice` filter that used to keep vague,
non-actionable suggestions ("consider monitoring this") from becoming
issues. `handoff_view()` already withholds `observability_recommendations`
entirely, which was the main source of that noise, so what remains is the
occasional soft `recommended_action` that a coding agent will now close as
not planned. Accepted deliberately: the costs are not symmetric — an unfiled
defect is a fix that never happens, while an unnecessary issue costs a coding
agent a few minutes to close.
