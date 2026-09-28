# What OpenChoreo v1.3.0 changes for the SRE agent

Resolves wayfinder ticket tharindulak/labs-agentic-engineer#3 (map: #2).
Researched 2026-09-28 against primary sources only.

## Sources

- Release notes: <https://github.com/openchoreo/openchoreo/releases/tag/v1.3.0> (published 2026-09-19).
- Source at tag `v1.3.0` (commit `178dfbde3e3343e5ac151b88a2f203f523f97480`), compared with tag `v1.2.6`
  (the previous release; release notes "Full Changelog" is `v1.2.6...v1.3.0`).
  Links below use `OC@v1.3.0/<path>#L<n>` = `https://github.com/openchoreo/openchoreo/blob/v1.3.0/<path>#L<n>`.
- Versioned docs: `openchoreo/openchoreo.github.io` `versioned_docs/version-v1.3.x/ai/sre-agent.mdx`
  (rendered at <https://openchoreo.dev/docs/v1.3.x/ai/sre-agent>).
- PR #4743 "broaden sre agent tooling and add an extensions mechanism" (merged 2026-09-16):
  <https://github.com/openchoreo/openchoreo/pull/4743>.

**Baseline correction.** The ticket brief described `src/extensions/config.py` as 1.2.x behaviour. It is not:
`v1.2.6` has no `agents/sre-agent/src/extensions/` directory. Extensions arrive **new in v1.3.0** (PR #4743).
The local checkout at `/Users/admin/Documents/wso2/git/openchoreo` is a post-1.3 `main` (HEAD `50a8a648`,
2026-09-25), not 1.2.x.

## Answer in one paragraph

v1.3.0 does **not** widen LLM provider support: the same three settings (`RCA_MODEL_NAME`, `RCA_LLM_API_KEY`,
`RCA_LLM_BASE_URL`), the same `init_chat_model` call, and only `langchain-openai` is shipped (no
`langchain-anthropic` in `pyproject.toml` or `uv.lock`); docs still say OpenAI only. The model is still built once
per process. What is new is a per-agent **extensions directory** (`/etc/openchoreo/sre-agent/{rca,remediation,chat}/`
with `mcp.json`, `skills/<name>/SKILL.md`, `CONTEXT.md`) that is re-read **on every agent run**, so file changes
apply without a restart. There are still **no post-RCA hooks or webhooks**; reports are only written to the report
store and read through the REST API or the agent's MCP server. The Helm chart gains **no** values for the LLM or for
extensions and does **not** mount the extensions directory, so using extensions on 1.3.0 needs a chart override or
post-render patch. Upgrade-relevant changes: RCA report rows gain `namespace`/`project` columns (auto-migrated at
startup, legacy rows fail closed on single-report authz), chat/report routes authorize against the stored report,
the agent's `/mcp` endpoint is now exposed on the gateway, several OpenChoreo MCP tool names changed, and the
deprecated `*_cluster_*` control-plane MCP tools are removed.

## 1. LLM providers and settings

| Aspect | v1.2.6 | v1.3.0 | Source (v1.3.0) |
|---|---|---|---|
| LLM settings | `rca_model_name`, `rca_llm_api_key`, `rca_llm_base_url` | unchanged | `OC@v1.3.0/agents/sre-agent/src/config.py#L20-L22` |
| Model construction | `init_chat_model(model=..., api_key=..., base_url?)` | unchanged; `base_url` forwarded only when set | `OC@v1.3.0/agents/sre-agent/src/clients/llm.py#L13-L25` |
| Provider packages | `langchain-openai>=1.4.0` | `langchain-openai>=1.4.1` only | `OC@v1.3.0/agents/sre-agent/pyproject.toml#L14` |
| `langchain-anthropic` | absent | **absent** (no `anthropic` string in `uv.lock`, `src/`, or `agents/common`) | `OC@v1.3.0/agents/sre-agent/uv.lock` |
| Docs on providers | OpenAI | "An LLM API key from OpenAI (support for other providers coming soon)"; "`gpt-5.6` series is not supported at the moment" | `version-v1.3.x/ai/sre-agent.mdx` L18, L83-L87 |

- No other LLM knobs (temperature, provider, headers, timeouts) are exposed as settings. `Settings` uses
  `extra="allow"` (`config.py#L14-L18`), but nothing reads extra keys for the model.
- Shared settings moved into a new `common` package (`CommonSettings`,
  `OC@v1.3.0/agents/common/src/common/config.py#L7-L53`, PR #4372). Env names are unchanged; new ones are
  `JWT_INSECURE_ALLOW_UNVERIFIED`, `JWKS_URL_TLS_INSECURE_SKIP_VERIFY`, `AUTHZ_TLS_INSECURE_SKIP_VERIFY`.
- Inference (LangChain behaviour, not OpenChoreo code): a model string that resolves to the `anthropic` provider
  would fail at runtime because the integration package is not in the image. A non-OpenAI model is reachable only
  through an OpenAI-compatible endpoint via `RCA_LLM_BASE_URL` (the code comment at `llm.py#L19-L22` names the
  `ai-gateway-agentgateway` module for this).

## 2. Reload behaviour

| What | When it is read | Source |
|---|---|---|
| LLM settings / model | Once. `settings = Settings()` at import (`config.py#L58`); `get_model` is `@lru_cache` with defaults bound at import (`llm.py#L13-L17`); each module-level `Agent` calls `get_model()` in `__init__` (`agent/agent.py#L64`). Startup also does a live `ainvoke("Hello")` and fails the pod if it errors (`main.py#L34-L41`). | cited |
| Extensions (`mcp.json`, skills, `CONTEXT.md`) | **Per agent run.** `Agent.create()` calls `apply_extensions(self.name)` every time (`agent/agent.py#L89`), and `create()` runs per chat request (`#L220`), per RCA analysis (`#L305`) and per remediation (`#L338`). Startup only validates/logs (`main.py#L76-L79`). | cited |
| External MCP tool discovery | Per run, 10 s timeout per server; failures skip that server, not the request (`extensions/runtime.py#L25`, `#L49-L85`). | cited |

So: rotating `RCA_LLM_API_KEY` or changing the model still needs a pod restart (the Deployment's
`checksum/config` annotation rolls the pod when `rca-agent-config` changes, `templates/sre-agent/deployment.yaml#L28`;
Secret changes do not roll it). Extension files, if mounted from a ConfigMap, take effect once kubelet syncs the
volume, with no restart. `${VAR}` header references resolve from the process environment, so a new env var still
needs a restart.

## 3. Extension points

Root: `extensions_dir = "/etc/openchoreo/sre-agent"` (`config.py#L38`), one subdirectory per agent name:
`rca`, `remediation`, `chat` (`agent/agent.py#L125-L194`; `extensions/config.py#L164-L185`).

| File | Behaviour | Source |
|---|---|---|
| `mcp.json` | `{"mcpServers": {name: {type|transport, url, headers}}}`. Only `http`/`streamable_http`. `headers` require an `https://` URL. `${VAR}` in headers resolves from env; an unset var is an error. Tools are prefixed with the server name and bypass the built-in tool allow-list. | `extensions/config.py#L57-L101`; `runtime.py#L53-L56`; PR #4743 |
| `skills/<name>/SKILL.md` | YAML frontmatter with `name` (must equal directory) and `description`; only `SKILL.md` allowed in the directory. Names/descriptions go into the prompt; bodies are served by a `load_skill` tool. | `extensions/config.py#L104-L146`; `extensions/skills.py#L14-L41` |
| `CONTEXT.md` | Appended to the system prompt on every request as `extra_context`; warning above 8 KiB. | `extensions/config.py#L18`, `#L149-L161`; `runtime.py#L35-L40` |

- Errors in any file make that agent run with **no** extensions (logged), not fail
  (`runtime.py#L88-L93`).
- Extensions are per agent on purpose: "The RCA agent reads, the remediation agent acts" (PR #4743 remarks). An
  AE tool that writes (for example, filing an issue) belongs under `remediation` or `rca` deliberately.
- **Post-RCA hooks / webhooks: none.** `run_analysis` ends with `report_backend.upsert_rca_report(...)`
  (`agent/agent.py#L284`, `#L376-L386`); no callback, event, or notification is emitted. The observer still triggers RCA
  fire-and-forget via `POST {rcaServiceURL}/api/v1alpha1/rca-agent/analyze`
  (`OC@v1.3.0/internal/observer/service/alerts.go#L545-L600`, unchanged from v1.2.6). The only way to act after an
  RCA is (a) an extension MCP tool the RCA/remediation agent calls during the run, or (b) polling the report APIs.
- **RCA report APIs** (unchanged paths):
  - REST `GET /api/v1/rca-agent/reports`, `GET /api/v1/rca-agent/reports/{report_id}`,
    `PUT /api/v1/rca-agent/reports/{report_id}` (`api/report_routes.py#L18`, `#L48`, `#L90`, `#L125`).
  - REST `POST /api/v1alpha1/rca-agent/analyze`, `POST /api/v1alpha1/rca-agent/chat`
    (`api/agent_routes.py#L20`, `#L75`, `#L124`).
  - MCP tools `list_rca_reports`, `get_rca_report`, `analyze_runtime_state` at `/mcp`
    (`src/mcp_server.py#L184`, `#L245`, `#L280`).

## 4. Helm values and Secret wiring (`install/helm/openchoreo-observability-plane`)

- `rca.*` values are **identical** between v1.2.6 and v1.3.0 apart from a blank line (diffed). Relevant keys:
  `rca.secretName: "rca-agent-secret"` (`values.yaml#L1596`), `rca.llm.modelName` (`#L1608`),
  `rca.llm.baseUrl` (`#L1615`), `rca.extraEnvs` (`#L1693`), `rca.remedAgent: true` (`#L1478`).
- ConfigMap `rca-agent-config` maps `RCA_MODEL_NAME` and optional `RCA_LLM_BASE_URL`
  (`templates/sre-agent/rca-agent-config.yaml#L13-L16`); only addition is `JWT_INSECURE_ALLOW_UNVERIFIED` (`#L25`).
- Secret: loaded whole via `envFrom.secretRef: rca.secretName` before the ConfigMap
  (`templates/sre-agent/deployment.yaml#L67-L75`). The chart fails install if `rca.secretName` is empty and names
  the expected keys `RCA_LLM_API_KEY`, `OAUTH_CLIENT_SECRET`, optional `SQL_BACKEND_URI` (`#L2-L4`). Any extra key
  in that Secret (for example a token referenced as `${GITHUB_TOKEN}` from `mcp.json`) becomes an env var, which is
  how extension credentials are meant to stay out of the ConfigMap (PR #4743).
- **No extensions wiring.** The chart has no `extensions`/`extraVolumes`/`extraVolumeMounts` value for `rca`, and
  `/etc/openchoreo` is already a read-only mount of ConfigMap `observer-auth-config`
  (`deployment.yaml#L97-L100`, `#L111-L114`). Nothing mounts `/etc/openchoreo/sre-agent`, so on stock 1.3.0 the
  extensions directory is empty. AE needs a nested volume mount at `/etc/openchoreo/sre-agent` (ConfigMap with
  `items` paths like `rca/mcp.json`, `rca/skills/<n>/SKILL.md`, `rca/CONTEXT.md`) via a post-renderer/kustomize
  patch or an upstream chart change.
- New: HTTPRoute rule `mcp` exposing `/mcp` of the SRE agent through the gateway
  (`templates/sre-agent/http-route.yaml#L34-L41`) plus a kgateway `TrafficPolicy` with no request timeout and a
  24 h stream-idle timeout (`templates/sre-agent/traffic-policy.yaml#L1-L16`).
- New: platform identity labels on the pod (`deployment.yaml#L32`, PR #4636).

## 5. Renames and behaviour changes

- **OpenChoreo MCP tool set used by the agent** (PR #4655 "use native mcp tools"): hand-rolled REST tools removed
  from `tool_registry.py`; `get_component_workloads` becomes `list_workloads` / `get_workload`;
  `list_component_traits` removed; added `query_component_events`, `get_component`, `get_release_binding`,
  `get_resource`, `list_resource_release_bindings`, `get_resource_release_binding`
  (`OC@v1.3.0/agents/sre-agent/src/agent/tool_registry.py`; RCA set `agent/agent.py#L128-L141`).
  The `rca-agent` role now includes `resource:view` and `resourcereleasebinding:view`
  (`OC@v1.3.0/install/helm/openchoreo-control-plane/values.yaml#L1301-L1321`).
- **Removed control-plane MCP tools** `*_cluster_*` (release notes breaking change, PR #4724). Affects AE only if AE
  itself calls them by name.
- **Auth refactor** into `agents/common` (PR #4372): `src/auth/*` package moved; `auth-config.yaml` subject claim
  for the service account changed `sub` to `client_id` (`agents/sre-agent/auth-config.yaml#L17`).
- **Authorization moved to the stored report**: `GET/PUT /reports/{id}` and `/chat` with `report_context` call
  `auth.authorize_result(... action="rcareport:view|update")` on the report's own namespace/project
  (`api/report_routes.py#L106`, `#L144`; `api/agent_routes.py#L144`; PR #4680).
- **Schema**: `threshold` is `float` (was `int`) in the analyze request and `RCAReport`
  (`api/agent_routes.py#L33`, `models/rca_report.py#L43`); `value` also accepts `float`.
- ThunderID 1.0.1 replaces Thunder 0.28.0 (release notes breaking change); relevant only if AE customised Thunder
  values for the RCA OAuth client.

## 6. Upgrade notes affecting AE

1. **Report store migration runs at startup**: adds `namespace` and `project` columns and an index, then
   best-effort backfills legacy rows through the OpenChoreo API (`src/report_migration.py#L19-L60`;
   `clients/backend/sql_backend.py#L33-L40`, `#L63`; PR #4785). Rows that cannot be named have null
   namespace/project and **fail closed** on single-report reads (`sql_backend.py#L195-L197`).
2. **Anthropic still unsupported natively.** Claude via AE would need an OpenAI-compatible gateway on
   `rca.llm.baseUrl`, or an AE-built image adding `langchain-anthropic`. Neither is documented upstream.
3. **Extensions need an AE-side mount** (section 4). Mount per agent, keep write-capable tools out of `rca` unless
   intended, put tokens in `rca-agent-secret` and reference them as `${VAR}` over `https://` only.
4. **Model/key changes still need a restart**; extension edits do not.
5. **`/mcp` is now reachable through the gateway** when `rca.http.enabled` (default `true`). It enforces JWT auth
   (`main.py#L143-L147`), but it widens the exposed surface; review whether AE wants that route.
6. **No completion signal**: AE integrations that react to finished RCAs must poll
   `GET /api/v1/rca-agent/reports` or MCP `list_rca_reports`, or act inside the run through an extension tool.

## Open questions (not answerable from 1.3.0 sources)

- Whether upstream plans chart values for extensions or non-OpenAI providers ("coming soon" in docs has no linked
  issue). Check post-1.3 `main` before building AE-side patches.
