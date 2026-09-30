# Can the stock v1.3.0 sre-agent do RCA + remediation against an OpenChoreo v1.2.5 control plane?

Resolves wayfinder ticket tharindulak/labs-agentic-engineer#13 (map: #12).
Researched 2026-09-30 against primary sources only.

## Sources

- Repo: `github.com/openchoreo/openchoreo`.
- Tag `v1.2.5`, commit `da67de244e9542e84c92d7ea7816bf041851c140`. Tag `v1.3.0`, commit
  `178dfbde3e3343e5ac151b88a2f203f523f97480`. Both cloned shallow (`--depth 1 --branch`) into
  separate directories and diffed side by side.
- Tag `v1.2.6`, commit `9ed176ba7e37560d4ac3ff799c897381154d3a4d`, cloned only to answer the
  "is 1.2.5 == 1.2.6" question the ticket asks for (see "1.2.5 vs 1.2.6" below), then deleted.
- `langchain-mcp-adapters` upstream source (`github.com/langchain-ai/langchain-mcp-adapters`,
  default branch, pinned by sre-agent's `pyproject.toml` at `>=0.3.1`), read to determine
  `MultiServerMCPClient.get_tools()`'s failure semantics across servers — this library is not
  part of the openchoreo repo, so it is cited separately from `OC@<tag>/...` citations.
- Prior finding: issue #3 doc, `docs/design/draft/research/oc-v1.3.0-sre-agent.md` on branch
  `research/oc-v1.3.0-sre-agent` (not yet merged to `main`; read via
  `git show research/oc-v1.3.0-sre-agent:docs/design/draft/research/oc-v1.3.0-sre-agent.md`
  in the `labs-agentic-engineer` repo). Its tool-rename and auth-claim findings are re-verified
  below directly against v1.2.5 source, not assumed.

Citation convention: `OC@<tag>/<path>#L<n>` = `https://github.com/openchoreo/openchoreo/blob/<tag>/<path>#L<n>`.

## Answer in one paragraph

**Conditional-alive, closer to alive than the prior research assumed.** The central premise behind
"maybe there's no MCP server in 1.2.x at all" is false: v1.2.5's control plane (`openchoreo-api`)
and observer **already** expose the same `/mcp` streamable-HTTP endpoint, registered with the
identical `pkg/mcp` / `internal/observer/mcp` packages that ship in v1.3.0 — `pkg/mcp/tools` and
`internal/observer/mcp/server.go` are functionally unchanged between v1.2.5 and v1.3.0 (the only
diff is removal of deprecated `*_cluster_*` aliases and some new v1.3.0-only tools the agent
doesn't call). Every control-plane and observer MCP tool the v1.3.0 sre-agent's `RCA_AGENT`,
`REMED_AGENT` and `CHAT_AGENT` actually call — `list_components`, `get_component`,
`list_workloads`, `get_workload`, `list_release_bindings`, `get_release_binding`,
`get_component_release`, `get_component_release_schema`, `query_component_logs`,
`query_component_events`, `query_resource_metrics`, `query_traces`, `query_trace_spans` — exists in
v1.2.5 by the same name, with the same input schema and response shape (verified by diffing the Go
source directly, not just by name). Auth is a wash, not a blocker: the `sub`→`client_id` JWT-claim
rename noted in issue #3 is real, but it lives entirely in Helm-rendered ConfigMaps
(`observer-auth-config`, the control plane's `security.subjects.service_account` value) that a
1.2.5 deployment renders with `sub` on **both** the caller-classification side and the
`ClusterAuthzRoleBinding` side — it is never baked into the sre-agent's container image — so
running the v1.3.0 image against a v1.2.5 stack's own IdP/config is self-consistent regardless of
image version. The one real, reproducible gap is RBAC scope: v1.2.5's default `rca-agent`
`ClusterAuthzRole` (`OC@v1.2.5/install/helm/openchoreo-control-plane/values.yaml#L1286-L1304`)
lacks the `resource:view` and `resourcereleasebinding:view` actions that v1.3.0 added to that same
role. That doesn't 404 or crash anything: OpenChoreo's MCP `tools/list` filtering hides
unauthorized tools from the catalog before the agent ever sees them, and the sre-agent only logs a
warning for `self.tools - {found tools}` and proceeds — so `get_resource`,
`list_resource_release_bindings` and `get_resource_release_binding` silently disappear from both
the RCA and remediation agents' toolsets and every other tool call still works. Net effect: RCA and
remediation both run and produce a report; they're missing OpenChoreo `Resource`/
`ResourceReleaseBinding` visibility (used for infra-as-code style non-workload resources, e.g.
databases, queues, standalone infra CRDs a component's release binds to) unless the 1.2.5 role is
patched to add those two actions, which is a same-version Helm-values change requiring no code or
image change.

## Enumerated calls

### Control-plane MCP tools (`openchoreo` server, `<openchoreo_api_url>/mcp`)

The agent connects as an MCP client via `MultiServerMCPClient` with server key `"openchoreo"`,
URL `settings.openchoreo_mcp_url` = `openchoreo_api_url.rstrip('/') + "/mcp"`
(`OC@v1.3.0/agents/sre-agent/src/config.py#L30-L32`, `OC@v1.3.0/agents/sre-agent/src/clients/mcp.py#L36-L41`).
`openchoreo_api_url` defaults to
`http://openchoreo-api.openchoreo-control-plane.svc.cluster.local:8080`
(`OC@v1.3.0/agents/common/src/common/config.py#L20-L22`).

| Tool | Used by | v1.3.0 shape | v1.2.5 availability | Class |
|---|---|---|---|---|
| `list_components` | RCA, REMED, CHAT | `OC@v1.3.0/pkg/mcp/tools/component.go#L17-L26` | Identical: `OC@v1.2.5/pkg/mcp/tools/component.go#L17-L26`, action `component:view` | none — present |
| `get_component` | REMED | `OC@v1.3.0/pkg/mcp/tools/component.go#L40` | Identical: `OC@v1.2.5/pkg/mcp/tools/component.go#L40`, action `component:view` | none |
| `list_workloads` | REMED | `OC@v1.3.0/pkg/mcp/tools/component.go#L61` | Identical: `OC@v1.2.5/pkg/mcp/tools/component.go#L61`, action `workload:view` | none |
| `get_workload` | REMED | `OC@v1.3.0/pkg/mcp/tools/component.go#L84` | Identical: `OC@v1.2.5/pkg/mcp/tools/component.go#L84`, action `workload:view` | none |
| `list_release_bindings` | RCA, REMED | `OC@v1.3.0/pkg/mcp/tools/component.go#L223` | Identical: `OC@v1.2.5/pkg/mcp/tools/component.go#L223`, action `releasebinding:view` | none |
| `get_release_binding` | RCA, REMED | `OC@v1.3.0/pkg/mcp/tools/component.go#L104` | Identical: `OC@v1.2.5/pkg/mcp/tools/component.go#L104`, action `releasebinding:view` | none |
| `get_component_release` | RCA, REMED | `OC@v1.3.0/pkg/mcp/tools/pe.go` (registration ~L375) | Identical (only description-text diff mentioning removed cluster aliases): `OC@v1.2.5/pkg/mcp/tools/pe.go#L375`, action `componentrelease:view` | none |
| `get_component_release_schema` | REMED | `OC@v1.3.0/pkg/mcp/tools/pe.go` (~L395) | Identical: `OC@v1.2.5/pkg/mcp/tools/pe.go#L395`, action `componentrelease:view` | none |
| `get_resource` | RCA | `OC@v1.3.0/pkg/mcp/tools/resource.go#L18-L43` (byte-identical to 1.2.5 — `diff` reports zero) | Tool exists byte-identical, action `resource:view` — **but `resource:view` is not in v1.2.5's `rca-agent` role** (`OC@v1.2.5/install/helm/openchoreo-control-plane/values.yaml#L1286-L1304`, vs `OC@v1.3.0/.../values.yaml#L1301-L1321` which adds it) | **soft** |
| `list_resource_release_bindings` | RCA, REMED | `OC@v1.3.0/pkg/mcp/tools/resource_release_binding.go#L17-L19` (byte-identical file to 1.2.5) | Tool exists, action `resourcereleasebinding:view` — **not in v1.2.5's `rca-agent` role** | **soft** |
| `get_resource_release_binding` | RCA, REMED | `OC@v1.3.0/pkg/mcp/tools/resource_release_binding.go#L42-L44` | Tool exists, action `resourcereleasebinding:view` — **not in v1.2.5's `rca-agent` role** | **soft** |

`patch_releasebinding` and `create_workload` are defined as `Tool` constants in
`OC@v1.3.0/agents/sre-agent/src/agent/tool_registry.py#L61-L75` but are **not** included in
`RCA_AGENT.tools`, `REMED_AGENT.tools` or `CHAT_AGENT.tools`
(`OC@v1.3.0/agents/sre-agent/src/agent/agent.py#L125-L194`) — dead constants, out of scope. Same
for `get_trait_schema`, `list_environments`, `list_namespaces`, `list_projects` — defined, never
wired to a running agent. Remediation in the shipped code is advisory-only: every `REMED_AGENT`
tool is read-only; there is no write/patch tool in its actual toolset, so it produces
recommendations (`RemediationResult.recommended_actions`), not autonomous cluster mutation.

### Observer MCP tools (`observability` server, `<observer_api_url>/mcp`)

Same client, server key `"observability"`, URL `settings.observer_mcp_url` =
`observer_api_url.rstrip('/') + "/mcp"` (`OC@v1.3.0/agents/sre-agent/src/config.py#L24-L28`).
`observer_api_url` defaults to `http://observer:8080`. **Important correction to the ticket's
framing**: the v1.3.0 sre-agent has no direct REST client to the observer for logs/metrics/traces
at all — `grep` over `agents/sre-agent/src/` for `observer` finds only the config/URL derivation
and the `mcp_server.py` docstring; there is no `clients/observer_rest.py` or equivalent. All
observer data access is MCP, both at v1.3.0 and v1.2.5.

| Tool | Used by | v1.3.0 shape | v1.2.5 availability | Class |
|---|---|---|---|---|
| `query_component_logs` | RCA, CHAT | `OC@v1.3.0/internal/observer/mcp/server.go` (registration block, action `logs:view`) | Identical input schema/handler call, only a cosmetic description-string diff ("Organization namespace" → "Namespace"): `OC@v1.2.5/internal/observer/mcp/server.go` | none |
| `query_component_events` | RCA | same file | Identical (cosmetic diff only) | none |
| `query_resource_metrics` | RCA, CHAT | same file | Identical (cosmetic diff only) | none |
| `query_traces` | RCA, CHAT | same file | Identical (cosmetic diff only) | none |
| `query_trace_spans` | RCA, CHAT | same file | Identical (cosmetic diff only) | none |

Diffed line-for-line per tool (`diff` on each tool's registration block extracted from
`internal/observer/mcp/server.go` at both tags): the only differences across the whole file are
(a) six new v1.3.0-only tools the agent never calls (`query_platform_logs`, `query_costs`,
`query_recommendations`, `query_audit_logs`, `query_dora_metrics`, `query_dora_deployments`), (b)
v1.3.0 wraps the server in an audit middleware (`mcpaudit`) and switches
`StreamableHTTPOptions{Stateless: true}` vs v1.2.5's default (stateful) session mode, and (c)
description-string wording. None of (b)/(c) is visible to a spec-compliant streamable-HTTP MCP
client: `langchain-mcp-adapters`'s `MultiServerMCPClient` opens ["a new session... for each tool
call"](https://github.com/langchain-ai/langchain-mcp-adapters — `client.py` docstring on
`get_tools`), i.e. it never depends on the server persisting session state across calls, so a
stateful v1.2.5 server behaves the same as a stateless v1.3.0 one from this client's perspective.

`query_workflow_logs`, `query_http_metrics`, `get_span_details` are registered in both tags,
byte-identical/near-identical, but not wired to any of the three agents — out of scope, listed here
only because they're the remaining entries in `tool_registry.py`'s `OBSERVABILITY_TOOLS` set.

### Report-migration REST call (control plane, not MCP)

`report_migration.py`'s startup backfill (adds `namespace`/`project` to legacy report rows) uses a
plain REST client, `src/clients/openchoreo_api.py`, hitting `GET /api/v1/namespaces` and
`GET /api/v1/namespaces/{namespace}/projects` with header `X-Use-OpenAPI: true`
(`OC@v1.3.0/agents/sre-agent/src/clients/openchoreo_api.py#L13-L31`,
`OC@v1.3.0/agents/sre-agent/src/report_migration.py#L91-L103`). Both routes are registered
unchanged in v1.2.5's generated server (`OC@v1.2.5/internal/openchoreo-api/api/gen/server.gen.go#L207-L217`,
identical to `OC@v1.3.0/.../server.gen.go#L207-L217`). This runs once per process start,
best-effort (failures are logged, not fatal) — **no gap**.

### MCP client failure semantics (why the 3 soft gaps stay soft, and what a *harder* failure would do)

`MCPClient.get_tools()` calls `MultiServerMCPClient.get_tools()`, which loads both servers'
tools concurrently via `asyncio.gather(*load_mcp_tool_tasks)` with no `return_exceptions=True`
(`langchain_mcp_adapters/client.py`, `get_tools`, upstream source, function body around line
198-216) — **so if either server is completely unreachable (wrong URL, connection refused, TLS
failure), the whole `gather` raises and `MCPClient.get_tools()` re-raises as `RuntimeError`**
(`OC@v1.3.0/agents/sre-agent/src/clients/mcp.py#L51-L58`), which is not caught in `Agent.create()`
(`OC@v1.3.0/agents/sre-agent/src/agent/agent.py#L76-L88`) and propagates to `run_analysis`'s
top-level `except Exception`, which marks the report `status="failed"`
(`OC@v1.3.0/agents/sre-agent/src/agent/agent.py#L447-L459`). That would be the **hard** case — but
it doesn't apply here, because both `/mcp` endpoints exist and are reachable at v1.2.5 (verified
above). The RBAC gap instead surfaces earlier and more gently: unauthorized tools are filtered out
of `tools/list` server-side (`OC@v1.2.5/pkg/mcp/tools/filter.go#L95-L124`,
`filterListTools`/`isAllowed`), so `get_tools()` succeeds and simply returns a smaller tool list;
`Agent.create()` computes `missing = self.tools - {t.name for t in tools}` and only
`logger.warning`s (`OC@v1.3.0/agents/sre-agent/src/agent/agent.py#L82-L87`) — it does not raise.
This is the exact mechanism that keeps the resource/resourcereleasebinding gap **soft**.

## Auth / token flow

**OAuth2 client-credentials outbound (agent → control plane / observer)**: unchanged in substance
between v1.2.5 and v1.3.0. `get_oauth2_auth()` builds an `httpx.Auth` that does a
`grant_type=client_credentials` POST via `authlib`'s `AsyncOAuth2Client` with
`token_endpoint_auth_method="client_secret_post"` against `OAUTH_TOKEN_URL`, using
`OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET`/optional `OAUTH_SCOPE`
(`OC@v1.2.5/agents/sre-agent/src/auth/oauth_client.py#L71-L84`,
`OC@v1.3.0/agents/common/src/common/auth/oauth_client.py` — same grant mechanics, v1.3.0 adds a
lock and a cached-`expires_at` short-circuit but issues the identical token request). This code
path is agnostic to which claim the resulting token carries; it just presents whatever the
configured IdP issues.

**`sub` → `client_id` claim rename (issue #3 finding), re-verified against v1.2.5 directly:**
v1.2.5's `rca-agent-binding` (`ClusterAuthzRoleBinding`) is configured with
`entitlement.claim: sub`, `value: openchoreo-rca-agent`
(`OC@v1.2.5/install/helm/openchoreo-control-plane/values.yaml#L1786-L1796`); v1.3.0's is
`claim: client_id` (`OC@v1.3.0/.../values.yaml#L1818-L1828`). This is real, but it is **not** a
sre-agent-image-version concern: the control plane's own JWT-claim-to-subject-type mapping is
**also** rendered by the same Helm chart, from the same source of truth
(`security.subjects.service_account.mechanisms.jwt.entitlement.claim`,
`OC@v1.2.5/install/helm/openchoreo-control-plane/values.yaml#L1169-L1173` = `"sub"` vs
`OC@v1.3.0/.../values.yaml#L1183-L1187` = `"client_id"`) — i.e. a stock v1.2.5 deployment is
internally self-consistent on `sub`, independent of what sre-agent image you point at it, because
this claim-matching happens entirely control-plane-side (`internal/authz/casbin/pdp.go`'s
`formatSubject(claim, value)` → `"claim:value"` string compared against the same-format
role-binding string, `OC@v1.3.0/internal/authz/casbin/helpers.go#L429-L434`, identical in v1.2.5).
The sre-agent's own `auth-config.yaml` (used to classify an *incoming* caller's JWT for the
sre-agent's own REST endpoints — report view/update, chat) similarly is **not baked into the
container image** for a Helm deployment: `AUTH_CONFIG_PATH=/etc/openchoreo/auth-config.yaml` is set
by the ConfigMap `rca-agent-config`
(`OC@v1.3.0/install/helm/openchoreo-observability-plane/templates/sre-agent/rca-agent-config.yaml#L28`),
and that file is mounted from ConfigMap `observer-auth-config`
(`OC@v1.3.0/.../templates/sre-agent/deployment.yaml#L97-L114`), whose content is rendered from
Helm value `.Values.observer.security.subjectTypes` — i.e. it travels with whichever chart version
renders the deployment, not with the container image tag. Deploying the v1.3.0 image via a v1.2.5
observability-plane chart (only overriding the image reference) renders `claim: sub` into that
ConfigMap, matching v1.2.5's own control-plane binding. The repo-local
`agents/sre-agent/auth-config.yaml` file (which differs, `client_id` at v1.3.0 vs `sub` at
v1.2.5 — `OC@v1.2.5/agents/sre-agent/auth-config.yaml#L17` vs
`OC@v1.3.0/agents/sre-agent/auth-config.yaml#L17`) is a dev-mode default read only when no
ConfigMap is mounted (`auth_config_path` default `"auth-config.yaml"`,
`OC@v1.3.0/agents/common/src/common/config.py#L24`); it is not what a Helm-deployed pod uses. **No
gap for RCA/remediation** — and for the one endpoint that matters most to the RCA trigger,
`POST /api/v1alpha1/rca-agent/analyze` has **no auth dependency at all**
(`OC@v1.3.0/agents/sre-agent/src/api/agent_routes.py#L71-L74`, no `Depends(require_authn)`),
identical in v1.2.5.

Even if a mismatch were somehow introduced (e.g. someone hand-rolls a Deployment mixing a v1.3.0
chart's `auth-config.yaml` with a v1.2.5 control plane), `extract_subject_context`'s fallback is
soft, not a hard failure: an unmatched claim just falls through to a default
`SubjectContext(type="user", entitlementClaim="sub", entitlementValues=[claims.get("sub")])`
(`OC@v1.3.0/agents/common/src/common/auth/dependencies.py#L83-L99`) rather than raising — again
consistent with v1.2.5's own `sub`-keyed bindings for anything not otherwise classified.

**Config env vars needed** (from `OC@v1.3.0/agents/sre-agent/src/config.py` and
`OC@v1.3.0/agents/common/src/common/config.py`): `RCA_MODEL_NAME`, `RCA_LLM_API_KEY`,
`RCA_LLM_BASE_URL` (optional), `OBSERVER_API_URL`, `OPENCHOREO_API_URL`, `REPORT_BACKEND`,
`SQL_BACKEND_URI`, `MAX_CONCURRENT_ANALYSES`, `ANALYSIS_TIMEOUT_SECONDS`, `REMED_AGENT`,
`EXTENSIONS_DIR`; from common: `JWT_JWKS_URL`, `JWT_ISSUER`, `JWT_AUDIENCE`,
`JWT_JWKS_REFRESH_INTERVAL`, `JWT_INSECURE_ALLOW_UNVERIFIED`, `AUTHZ_TIMEOUT_SECONDS`,
`AUTH_CONFIG_PATH`, `OAUTH_TOKEN_URL`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_SCOPE`,
`LOG_LEVEL`, `TLS_INSECURE_SKIP_VERIFY`, `JWKS_URL_TLS_INSECURE_SKIP_VERIFY`,
`AUTHZ_TLS_INSECURE_SKIP_VERIFY`, `CORS_ALLOWED_ORIGINS`. Every one of these is already produced by
v1.2.5's `openchoreo-observability-plane` chart's `rca-agent-config` ConfigMap and
`rca-agent-secret` Secret template (`OC@v1.2.5/install/helm/openchoreo-observability-plane/templates/sre-agent/rca-agent-config.yaml`
— diffed against v1.3.0's version above: only `JWT_INSECURE_ALLOW_UNVERIFIED` and a pod-label
include are new in v1.3.0's template, and `JWT_INSECURE_ALLOW_UNVERIFIED`'s Pydantic default
(`False`) is the same value the v1.3.0 chart would render anyway, so its absence from the v1.2.5
template is a no-op). `JWT_JWKS_REFRESH_INTERVAL` is not templated by either chart version; both
fall back to the Pydantic default (3600s) — no gap.

## 1.2.5 vs 1.2.6 (does the ticket's baseline hold?)

Confirmed identical for everything this ticket touches:
`diff -rq v1.2.5/agents/sre-agent v1.2.6/agents/sre-agent`,
`diff -rq v1.2.5/pkg/mcp v1.2.6/pkg/mcp`,
`diff -rq v1.2.5/internal/observer/mcp v1.2.6/internal/observer/mcp`,
`diff -rq v1.2.5/install/helm/openchoreo-observability-plane v1.2.6/install/helm/openchoreo-observability-plane`,
and `diff -rq v1.2.5/install/helm/openchoreo-control-plane v1.2.6/install/helm/openchoreo-control-plane`
all produced zero output (checked directly; `v1.2.6` deleted after). `agents/common` does not exist
at either 1.2.x tag.

## Hard gaps

None found. No required control-plane or observer call is absent, misnamed, or shape-incompatible
at v1.2.5, and no configuration mismatch causes the agent to fail startup or abort a whole
analysis run.

## Soft gaps

- `get_resource` MCP tool call (RCA agent): v1.2.5's `rca-agent` role lacks `resource:view`, so the
  tool is filtered out of `tools/list`; RCA proceeds without `Resource`-level visibility (a report
  is still produced) —
  `OC@v1.2.5/install/helm/openchoreo-control-plane/values.yaml#L1286-L1304` (role) vs
  `OC@v1.3.0/.../values.yaml#L1301-L1321` (role with `resource:view` added);
  `OC@v1.2.5/pkg/mcp/tools/resource.go#L18` (tool/action).
- `list_resource_release_bindings` MCP tool call (RCA + remediation agents): same missing
  `resourcereleasebinding:view` action on v1.2.5's `rca-agent` role; tool filtered from catalog,
  both agents proceed without it —
  `OC@v1.2.5/pkg/mcp/tools/resource_release_binding.go#L17-L19`.
- `get_resource_release_binding` MCP tool call (RCA + remediation agents): same cause —
  `OC@v1.2.5/pkg/mcp/tools/resource_release_binding.go#L42-L44`.

All three degrade via the same mechanism: OpenChoreo's MCP `tools/list` authz filtering
(`OC@v1.2.5/pkg/mcp/tools/filter.go#L95-L124`) hides the tool before the agent's tool-discovery
step ever sees it, and `Agent.create()`'s `missing` check only logs a warning
(`OC@v1.3.0/agents/sre-agent/src/agent/agent.py#L82-L87`) rather than aborting. Fix (same-version,
no code change): add `resource:view` and `resourcereleasebinding:view` to the `rca-agent`
`ClusterAuthzRole` in the v1.2.5 control-plane's Helm values.

## Open questions

- **Runtime behavior of a stateful-vs-stateless MCP session mismatch is unverified beyond source
  reading.** v1.2.5's observer/control-plane MCP servers run the default (stateful) streamable-HTTP
  session mode; v1.3.0's run `Stateless: true`. Source analysis of `langchain-mcp-adapters`
  (`get_tools()` opens one session per tool-discovery call, matching either mode) says this should
  be a non-issue, but this has not been exercised against a live v1.2.5 pod — flagged as unverified,
  would need a live run.
- **What Thunder (the v1.2.x IdP) actually puts in the `sub` claim for a client-credentials token**
  is outside this repo (Thunder is a separate WSO2 product not vendored here). The control-plane
  and sre-agent config both assume `sub` carries the client identifier at v1.2.5, and the whole
  authz chain is self-consistent under that assumption, but the actual JWT payload was not observed
  — unverified, would need a live run against a real v1.2.5 Thunder instance.
- **Whether AE actually plans to deploy the v1.3.0 image via a stock v1.2.5 Helm chart (image-tag
  override only) versus hand-assembling a custom Deployment** changes which of the "config travels
  with the chart, not the image" conclusions above apply as-is. This doc assumes the former (the
  natural, lowest-effort path); a hand-rolled Deployment that copies v1.3.0's chart YAML verbatim
  while pointing at v1.2.5 services would need to re-derive the `sub` vs `client_id` choice
  manually.
- Whether upstream OpenChoreo documents a minimum control-plane version for a given sre-agent image
  tag was not found in the v1.3.0 release notes or versioned docs during this pass — if such a
  compatibility matrix exists it wasn't linked from the v1.3.0 release.
