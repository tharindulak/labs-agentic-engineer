# SRE-agent extensions

Content mounted into the OpenChoreo SRE agent's `EXTENSIONS_DIR`
(`/etc/openchoreo/sre-agent` by default), using the SRE agent extension point.

The AE handoff lives under `remediation/` because the remediation agent already
has the RCA report, root cause, evidence, and recommended actions in scope. That
is the right point to search AE issues and file exactly one AE issue for coding
agent adoption.

- `remediation/mcp.json` points the remediation agent at `aep-mcp-server` with
  a bearer token resolved from `AEP_MCP_TOKEN`.
- `remediation/CONTEXT.md` is the unconditional handoff trigger.
- `remediation/skills/coding-agent-handoff/` is not stored here. It is mounted
  from `services/aep-mcp-server/skills/coding-agent-handoff/SKILL.md` at deploy
  time so that MCP server behavior and the SRE agent instructions stay in sync.

There is no `rca/` directory here. The RCA agent has no AE-specific extension;
the remediation phase owns the handoff.
