# Can the OpenChoreo 1.2.5 observability-plane chart carry the v1.3.0 agent image with AE's wiring?

Resolves [#14](https://github.com/tharindulak/labs-agentic-engineer/issues/14), part of map [#12](https://github.com/tharindulak/labs-agentic-engineer/issues/12).

## Verdict

**Yes.** Diffing `install/helm/openchoreo-observability-plane/` between upstream
tags `v1.2.5` (`fdd3a9ae`, 2026-09-07) and `v1.3.0` (`7db07e6b`, 2026-09-19) in
[github.com/openchoreo/openchoreo](https://github.com/openchoreo/openchoreo)
shows the `sre-agent` templates and `rca.*` values are essentially unchanged
between the two chart releases. Every mechanism AE's wiring from
[wso2/labs-agentic-engineer#841](https://github.com/wso2/labs-agentic-engineer/pull/841)
depends on — the `rca.extraEnvs` → `secretKeyRef` path into Secret
`sre-agent-aep`, the `sre-agent` Deployment/container/label name, the
ConfigMap keys the image reads at startup, the post-renderer's volumes, and
the probes/ports/Service — is present, identically shaped, on the 1.2.5
chart. AE does **not** need the 1.3.0 chart to run the `v1.3.0` image; only
the `--rca-image-tag`/`--rca-image-repo` override (already how `aectl sre`
installs the agent) is needed against a plane already on the 1.2.5 chart.

The two real differences the diff turned up are additive, chart-only features
(pod attribution labels, a new externally-reachable `/mcp` route + traffic
policy for the agent's own MCP server, a default-on NetworkPolicy) that AE's
flow does not read or need. None of them block the #841 loop. See Gaps below
for what's missing and how (not) to close it.

## Method

```
git clone --filter=blob:none --no-checkout https://github.com/openchoreo/openchoreo.git
git fetch origin v1.2.5 v1.3.0
git diff v1.2.5 v1.3.0 -- install/helm/openchoreo-observability-plane/
```
Cloned into `/private/tmp/claude-501/.../scratchpad/oc-r2` (session scratchpad,
not part of this repo). `agents/sre-agent/src/config.py` and its neighbors were
read at `v1.3.0` directly with `git show v1.3.0:<path>`. AE's post-renderer and
values were read from `origin/refactor-sre-agent` (the #841 branch,
head `a9739520` per map #12) fetched into this worktree.

## Chart diff, file by file

`install/helm/openchoreo-observability-plane/templates/sre-agent/`:

| File | v1.2.5 → v1.3.0 |
|---|---|
| `deployment.yaml` | +1 line: pod template gets `platformIdentityLabels` (`openchoreo.dev/plane`, `openchoreo.dev/plane-id`). No change to containers, env, ports, probes, volumes. |
| `service.yaml` | No diff. |
| `pvc.yaml` | No diff. |
| `rca-agent-config.yaml` | +1 ConfigMap key: `JWT_INSECURE_ALLOW_UNVERIFIED` (see Gaps). |
| `http-route.yaml` | +1 rule: a `/mcp` path routed to the same `rca.name` Service/port, alongside the existing `/api/v1alpha1/rca-agent/chat` and `/api/v1/rca-agent/reports` rules (unchanged). |
| `traffic-policy.yaml` | New file (kgateway `TrafficPolicy`), only if `gateway.gatewayClassName` is `kgateway`: sets no request timeout / 24h stream-idle on the new `mcp` HTTPRoute section. |

Top-level `values.yaml` `rca:` block: **one line changed**, a blank-line
removal (`git diff v1.2.5 v1.3.0 -- .../values.yaml`, hunk at old line 1479).
No key was added, removed, renamed, or retyped under `rca.*`. The only other
values.yaml changes relevant to the observability namespace are unrelated to
the SRE agent: a new top-level `networkPolicy.*` block (see Gaps),
`observer.audit.*`, `observer.finOpsAdapter.*`, `observer.featurePreview.*`,
and `observer.security.subjectTypes[].auth_mechanisms[].entitlement.claim`
flipping its shipped default from `"sub"` to `"client_id"` — moot for AE
either way, since both `sreObsPlaneValuesTmpl` and `sreAgentValuesTmpl`
(`tools/aectl/cmd/sre_assets.go`) already pin this to `client_id` explicitly
for ThunderID 1.0 compatibility, regardless of the chart's own default.

`Chart.yaml` carries `version: 0.0.0-latest-dev` in both trees — the `1.2.5`/
`1.3.0` numbers are release-time CI substitutions, not something visible in
the source diff.

## Checklist from the ticket

**`rca.extraEnvs` + `secretKeyRef` into Secret `sre-agent-aep`.** Unaffected.
`deployment.yaml` renders `{{- if .Values.rca.extraEnvs }} env: {{ toYaml
.Values.rca.extraEnvs | nindent 8 }}` identically at both tags, right after
`envFrom: [secretRef: rca.secretName, configMapRef: rca-agent-config]`. AE's
`rcaExtraEnvsYAML` (`tools/aectl/cmd/sre_assets.go`) replaces this whole list
with `EXTENSIONS_DIR`, `AEP_MCP_URL`, `SSL_CERT_FILE`, then four
`secretKeyRef: {name: sre-agent-aep, key: ...}` entries
(`RCA_LLM_API_KEY`, `RCA_MODEL_NAME`, `RCA_LLM_BASE_URL`, `AEP_MCP_TOKEN`).
Kubernetes resolves `env:` after `envFrom:` and an explicit `env` entry wins
on a name collision, so these four override whatever `rca-agent-config` (via
`envFrom`) or `rca.secretName`'s own `RCA_LLM_API_KEY` would otherwise supply
— exactly the precedence the sibling ticket
[research/rca-secret-env-precedence](https://github.com/tharindulak/labs-agentic-engineer/tree/research/rca-secret-env-precedence)
already established, and it holds at both chart versions.

**Deployment name `sre-agent`.** Unaffected. `rca.name` defaults to
`"sre-agent"` in both `values.yaml`s (only a blank line differs in that
whole `rca:` block); `deployment.yaml` names the Deployment, the pod
template's `app.kubernetes.io/component` label, and the container itself
all `{{ .Values.rca.name }}`, unchanged in the diff. AE's post-renderer
(`sre_postrender.go`) matches on that label via `sreAgentComponents =
["sre-agent", "ai-rca-agent"]`, so it finds the container on either chart.

**ConfigMap keys / env vars the `v1.3.0` image reads at startup, including
the extensions path.** `agents/sre-agent/src/config.py` at `v1.3.0` defines
`extensions_dir: str = "/etc/openchoreo/sre-agent"` (pydantic-settings maps
this to env var `EXTENSIONS_DIR`, case-insensitive) and `rca_model_name`,
`rca_llm_api_key`, `rca_llm_base_url`, `observer_api_url`, `report_backend`,
`sql_backend_uri`, `remed_agent`. Its parent `CommonSettings`
(`agents/common/src/common/config.py`) adds `jwt_*`, `openchoreo_api_url`,
`oauth_*`, `log_level`, `cors_allowed_origins`, `tls_insecure_skip_verify`,
and (new at `v1.3.0`) `jwt_insecure_allow_unverified: bool = False`. None of
these field names changed between the tags. `rca-agent-config.yaml`
(the ConfigMap `envFrom`-ed into the container) supplies all of them from
`rca.*`/`security.*` values at both chart versions; the one new key at
`v1.3.0`, `JWT_INSECURE_ALLOW_UNVERIFIED`, is rendered with `| default
"false"` in the template and the field itself already defaults to `False` in
`CommonSettings`, so its absence on the 1.2.5 chart is behaviourally
identical to the 1.3.0 chart's explicit `"false"` — not a gap.

`AEP_MCP_TOKEN` is read at runtime, not through `config.py`'s pydantic
model: `src/extensions/config.py`'s `_resolve_env_refs` substitutes
`${AEP_MCP_TOKEN}` (as authored literally in
`deployments/sre-agent-extensions/remediation/mcp.json`) from `os.environ`
when it loads the `remediation` extension's MCP server headers — it fails
extension loading if the var is unset. `AEP_MCP_URL` is *not* read from the
environment by the image: `renderMCPJSON` (`tools/aectl/cmd/sre_extensions.go`)
substitutes the concrete URL into `mcp.json`'s `url` field itself, at
ConfigMap-build time, because `_connection()` in `extensions/config.py`
never expands env refs in `url` (only in `headers`). AE still injects
`AEP_MCP_URL` as an env var for documentation/consistency, but the agent
doesn't need it set to work. `SSL_CERT_FILE` is a standard OpenSSL/Python
env var the underlying HTTP client honors directly; unrelated to chart
version.

`main.py`'s `lifespan()` calls `read_extensions(agent.name)` for
`RCA_AGENT`, `REMED_AGENT`, `CHAT_AGENT` (`agents/sre-agent/src/agent/agent.py`
at `v1.3.0`: `name="rca"`, `name="remediation"`, `name="chat"`) and treats a
missing/empty extensions directory as non-fatal. `REMED_AGENT.name ==
"remediation"` matches the directory AE's ConfigMap volume mounts at
`EXTENSIONS_DIR/remediation/{mcp.json,CONTEXT.md,skills/coding-agent-handoff/SKILL.md}`
(`sre_postrender.go`'s `sreExtensionsVolumeManifest`). This is agent-image
behaviour, orthogonal to which chart version rendered the Deployment.

**Volumes AE's post-renderer adds (extensions ConfigMap, CA bundle).**
Read from `tools/aectl/cmd/sre_postrender.go` on `origin/refactor-sre-agent`
(fetched into this worktree). `addExtensionsMount` finds the Deployment by
`app.kubernetes.io/component` label (via `sreAgentComponents`) and mutates
only `spec.template.spec.{volumes,initContainers}` and the matched
container's `volumeMounts`, appending-unless-already-named:
- volume `sre-agent-extensions` (ConfigMap, `optional: true`) mounted
  read-only at `/opt/aep/sre-agent-extensions`;
- volume `cluster-gateway-ca` (ConfigMap `cluster-gateway-ca`, key `ca.crt`)
  and an emptyDir `aep-ca-bundle`, merged by a Python initContainer
  (`aep-ca-bundle`, reusing the agent's own image) into
  `/opt/aep/ca/ca-bundle.crt`, mounted read-only at `/opt/aep/ca`.

This is chart-independent by construction: it operates on the *rendered*
manifest stream via a Helm post-renderer, keyed only on the component label
and container name that (per the Deployment name check above) are identical
at 1.2.5 and 1.3.0. `wireSREAgentDeployment` explicitly never round-trips
through a typed `corev1.PodSpec`, so it doesn't care whether the chart added
fields like `platformIdentityLabels` — it only reads/writes the three paths
it needs and leaves the rest of the chart's output untouched.

**Probes, ports, Service.** No diff at either tag: `livenessProbe`/
`readinessProbe` both `httpGet: {path: /health, port: http}`; container port
`http` = `.Values.rca.service.port` (default `8080`); Service `type:
ClusterIP`, port `.Values.rca.service.port` → `targetPort: http`. Selector
label `app.kubernetes.io/component: {{ .Values.rca.name }}` unchanged.

## Gaps found, and how (not) to close them

None of these block the #841 loop (log alert → RCA → remediation →
`ae_create_issue` files an `incident`); they're recorded for completeness
since the ticket asked to diff the whole template set.

1. **Missing `openchoreo.dev/plane` / `plane-id` pod labels.** 1.3.0's
   `deployment.yaml` stamps these via a new `_helpers.tpl` define
   (`platformIdentityLabels`) so the observability plane's own log pipeline
   can attribute a log record to a plane. The 1.2.5 chart has no such
   define to reuse and no values field drives it (it's a template-only
   addition, not a value), so there's no way to add it "without changing
   OpenChoreo" via values or the post-renderer — it would need a chart
   change. Only affects platform-side log attribution/telemetry, not
   anything AE reads back from the agent; not worth closing.

2. **Missing `/mcp` HTTPRoute + `TrafficPolicy` for the agent's own MCP
   server.** 1.3.0 adds a gateway-routed `/mcp` path (plus a matching
   `TrafficPolicy` disabling request timeout / setting a 24h stream-idle)
   so something *outside* the cluster can call the SRE agent's own MCP
   endpoint. AE's flow is the reverse direction — the agent calls out to
   `aep-mcp-server` over `AEP_MCP_URL`/`AEP_MCP_TOKEN` — and never needs an
   external caller to reach the agent as an MCP host through this ingress
   path. Closing it would need the same two chart files (or hand-authored
   equivalents added by the post-renderer, which today only touches
   Deployment volumes/mounts, not HTTPRoute/TrafficPolicy resources) if a
   future use case needs it; out of scope for the #841 loop today.
   (This is unrelated to the *control-plane* `/mcp` route and renamed MCP
   tools flagged as a known risk in map #12 / issue #3 — that's the
   OpenChoreo API's own MCP surface the `v1.3.0` image's `openchoreo_api_url`
   + `/mcp` calls hit at startup via `check_oauth2_connection`/`MCPClient`
   in `main.py`'s `lifespan()`, a control-plane-version question this
   ticket didn't investigate.)

3. **No default-on `NetworkPolicy`.** 1.3.0 adds
   `templates/networkpolicy.yaml` (`networkPolicy.enabled: true` by
   default), restricting ingress to same-namespace pods plus an
   allow-listed set of `app.kubernetes.io/name` values. The 1.2.5 chart has
   no such file, so an install from it is *more* permissive on ingress, not
   less — nothing to close for AE's wiring to keep working; only a
   defense-in-depth feature the 1.2.5 chart doesn't ship. Reproducing it
   would mean authoring the NetworkPolicy YAML as an extra manifest (not a
   value or a post-render of the sre-agent Deployment), out of scope here.

## Files and refs consulted

- Upstream (cloned to scratchpad, not part of this repo):
  `install/helm/openchoreo-observability-plane/{Chart.yaml,values.yaml,templates/_helpers.tpl,templates/sre-agent/*.yaml}`
  at tags `v1.2.5` (`fdd3a9ae512e26908958fc05cd6136466bfaf17b`) and `v1.3.0`
  (`7db07e6b66ab276428641dfa80aea8aa06130a8e`);
  `agents/sre-agent/src/{config.py,main.py,agent/agent.py,extensions/config.py,extensions/__init__.py}`
  and `agents/common/src/common/config.py` at `v1.3.0`.
- This repo, branch `origin/refactor-sre-agent` (#841, head `a97395208373a0ffd871a1d03879c101362a98f4`):
  `tools/aectl/cmd/{sre.go,sre_assets.go,sre_extensions.go,sre_plane.go,sre_postrender.go}`;
  `deployments/sre-agent-extensions/remediation/mcp.json`.

## Unverified

- Whether the OpenChoreo 1.2.5 **control plane** (`openchoreo-api`, not the
  observability-plane chart) exposes the `/mcp` route and tool names the
  `v1.3.0` image's `openchoreo_api_url`-based calls expect at startup. Flagged
  as a known risk on map #12 (issue #3) and out of this ticket's scope
  (chart diff only); resolving it is tracked elsewhere on the map.
- Whether `rca.secretName`'s own Secret (`rca-agent-secret`, holding
  `OAUTH_CLIENT_SECRET` and a placeholder `RCA_LLM_API_KEY`) needs any
  change between chart versions — out of the ticket's checklist and the
  diff showed no schema change to it, but its *contents* (as opposed to the
  schema) weren't independently re-verified against a live 1.2.5 install.
