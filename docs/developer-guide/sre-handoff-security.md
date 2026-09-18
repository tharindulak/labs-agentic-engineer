# SRE handoff security notes

The SRE handoff is intentionally narrow: the OpenChoreo SRE agent can search
related AE issues and create exactly one issue. AE owns classification,
deduplication, recurrence, adoption, dispatch, and human-attention state.

## Secret boundaries

- Anthropic keys are organization credentials managed through AE Console.
- Runtime projection uses secret references and a file mount; the SRE image
  reads `RCA_LLM_API_KEY_FILE`.
- The key value must not be serialized into Helm values, ConfigMaps, logs, MCP
  arguments, or documentation examples.
- The MCP bearer token is separate from the Anthropic key and is used only to
  let `aep-mcp-server` forward the caller identity to `aep-api`.

## Automation boundaries

- `ae_create_issue` is the SRE agent's only write.
- The SRE agent does not call a dispatch tool.
- Server-side issue classification decides whether an issue is adoptable.
- `provision` issues and terminal `not_planned` issues stop automated dispatch.
- Repeated recurrence reaches human attention instead of silently looping.

## Human review points

Keep auto-dispatch enabled only where automated code changes are acceptable.
Even then, AE leaves explicit review points:

- low-confidence fixes remain open for a human to verify and close;
- no-code-fix verdicts are visible as `not_planned`;
- fourth-and-later recurrence is escalated in the Console bell and Issues tab.
