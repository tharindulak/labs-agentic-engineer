# ADR-0030 — Action statuses are transport-carried too

`ae_create_issue` used to accept `actionStatuses` as a tool argument, and the
SRE agent's `handoff_outcome.py` middleware force-wrote it onto every call —
overwriting whatever the model supplied — because the remediation agent's own
comment recorded why: *"a status the model re-read off the report could move
[classification, adoption, dedupe namespace] all three,"* tracing back to live
incidents where a model-restated verdict was wrong. That force-write kept the
value correct, but it kept it correct by knowing AE's argument name
(`actionStatuses`) and forcing it into AE's specific call shape — the one thing
left in the SRE agent that named a specific receiver.

That receiver-specific knowledge lived in a provider descriptor
(`handoff/provider.json` on the AE side, `handoff_provider.py` on the SRE
side) whose entire reason to exist was to spell out AE's tool, header,
argument and answer-field vocabulary so the SRE agent's generic code did not
have to. Once the last receiver-specific fact — action statuses — moved off
that path, the descriptor had nothing left to describe.

Incident identity (project, component, error signature) had already solved
the identical problem: a fact the calling process computes, that the model
must not be trusted to restate, carried as a per-run header instead of an
argument (ADR-0025). Action statuses are the same shape of fact — computed
deterministically by the remediation stage, never the model's — and belong on
the same path.

## Decision

**Action statuses travel as a per-run header
(`x-aep-handoff-action-statuses`), config-driven, out of the model's reach —
the same way incident identity already travels.** The SRE agent's
`build_handoff_headers` renders whatever fields `Settings.handoff_header_map`
maps to header names, JSON-serializing a structured value the same way it
would any other configured field; it does not know that one of those fields
means "action statuses" any more than it knows one means "project." On the AE
side, `handoffContext.ts`'s `actionStatusesHeader` parses and validates the
header the same way the three identity headers already are: shape-checked
(an array of strings or nulls), and `ae_create_issue`'s `inputSchema` no
longer accepts `actionStatuses` as a caller-facing argument at all — the same
treatment already given to `dedupeKey` and `adopt`. A caller that cannot
spell a tool argument cannot restate it wrong.

**The provider descriptor is deleted, on both sides, along with the
middleware that force-wrote through it.** `handoff/provider.json`,
`handoff_provider.py`, and `handoff_outcome.py` (the force-injecting
middleware, and the result-parsing that decoded AE's answer into SRE-side
field names) are gone. The SRE agent discovers AE's tools via standard MCP
discovery — `mcp_client.get_tools(server_name="handoff")` — the same
mechanism it would use against any MCP server, naming nothing AE-specific.
Any deterministic fact that must reach AE rides `build_handoff_headers` /
`handoff_header_map` instead of a receiver-specific file: one generic
mechanism carries both incident identity and action-status facts, with no
branch that treats one configured header differently from another.

**The SRE-side handoff record is fully generic — no typed classification
field survives.** `HandoffResult` (`src/models/rca_report.py`) holds three
fields, and no more. `tool`, the name of the last tool call the handoff stage
made, and `result`, that call's answer carried verbatim, describe a completed
run; `failure_reason` covers the other path — set only by
`HandoffResult.failed()` when the stage crashed before it could file, and
left absent on a completed run because the last tool call is itself the
record of what happened. `ToolCallRecorder`
(`src/agent/middleware/tool_call_recorder.py`) feeds the completed-run
path — it appends `{"tool": ..., "result": ...}` for every tool call the
stage makes, in order, uninterpreted; nothing decides which call's answer
matters, because the handoff skill's own constraint ("creating that issue is
your only write") already guarantees the last call is the one that counts, so
the caller reads `calls[-1]`. `HandoffResult.compose(outcome)` takes that one
dict and does nothing to it beyond copying `tool` and `result` across. No
`HandoffClassification` enum, no `answer_fields` mapping, no `provider_facts`
survive: if AE adds or renames a fact tomorrow, nothing in the SRE repo has to
change to keep carrying it. The read side follows the same rule instead of
reintroducing typed fields on its own end: `should_publish_report`
(`src/clients/sink/report_sink.py`) reads `report_data["handoff"]["result"]`
as a plain dict and checks a truthy `deduped` key — it does not know or
assume which tool produced that key, only that this incident was already
reported when it is present. Any console or sink built on top of this report
reads facts out of `handoff.result` the same way, not off named top-level
fields that no longer exist.

**Content-shaping that used to be a Python guarantee is now a skill
instruction.** `RCAReport.handoff_view()` used to withhold
`observability_recommendations` and strip a `revised` action's `change` patch
in code, before the model ever saw the report. That function is deleted; the
model now receives the full report, and the `coding-agent-handoff` skill's
"What you see and must not carry forward" section carries the same two rules
as instructions instead of a filter. This is an accepted cost, not an
oversight: a Python filter guaranteed the exclusion; an instruction is a
strong convention a model could fail to follow. The trade is deliberate
because the failure costs are not symmetric — an issue that wrongly includes
an extra section is a paragraph the coding agent skips past, while there is
no equivalent cheap recovery for a Python filter that had wrongly withheld
information a fix actually needed. The same asymmetry already justified
Option 1's earlier acceptance of soft recommended actions reaching the coding
agent (ADR-0025's "known gaps" section); this extends the same reasoning to
content-shaping.

## Known gaps, carried forward

This design does not close the gaps ADR-0025 already recorded (the
not-planned verdict having nowhere to land on the report row, `escalate.go`
as a quiet backstop, `splitActions`' blind spot on an absent status) — none of
them are touched by this change, so they remain open exactly as recorded
there.

It adds one gap of its own: **the content-shaping guarantee is now a
convention, not an invariant.** A model that does not follow the
`coding-agent-handoff` skill closely enough could include an observability
recommendation or a `revised` action's raw config patch in a filed issue.
Nothing downstream enforces the exclusion the way `handoff_view()` used to.
This is accepted, not overlooked — see the "Decision" section above for why —
but it means a skill-conformance check, not a Python unit test, is the only
thing that can catch a regression here.
