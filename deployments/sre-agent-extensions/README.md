# SRE-agent extensions

Content mounted into the OpenChoreo SRE agent's `EXTENSIONS_DIR`
(`/etc/openchoreo/sre-agent` by default), per the generic extensions
mechanism added in openchoreo#4743. See
`docs/design/draft/2026-09-17-sre-agent-extensions-handoff.md` for why this
lives under `remediation/` rather than `rca/`.

- `remediation/mcp.json` — points the remediation agent at `aep-mcp-server`
  over HTTPS, with a bearer token resolved from `AEP_MCP_TOKEN` at process
  start.
- `remediation/CONTEXT.md` — the unconditional handoff trigger.
- `remediation/skills/coding-agent-handoff/` — **not stored here.** It is
  mounted from `services/aep-mcp-server/skills/coding-agent-handoff/` at
  deploy time (`aectl sre install` embeds it via `//go:embed`;
  `setup-observability.sh` reads it from the checkout) — that directory
  remains the single source of truth.

There is no `rca/` directory here — the RCA agent has nothing to mount; an
agent with no `EXTENSIONS_DIR/<name>/` behaves exactly as it does today.
