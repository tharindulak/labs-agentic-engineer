# Research: can stock OC v1.3.0 SRE agent extensions reproduce the AE handoff?

Ticket: tharindulak/labs-agentic-engineer#4 (map #2). Date: 2026-09-28.

Primary sources:

- `openchoreo/openchoreo` at tag `v1.3.0` (commit `178dfbde`), cited as `oc:` paths below.
- The extensions mechanism PR: https://github.com/openchoreo/openchoreo/pull/4743 (merged 2026-09-16, shipped in v1.3.0).
- `langchain-mcp-adapters` 0.3.2 (locked in `oc:agents/sre-agent/uv.lock:576`) and `httpx` 0.28.1 (`uv.lock:392`).
- AE code on this branch (base `ba9fe6b8`), cited as `ae:` paths.
- The patched agent's design doc, `tharindulak/openchoreo@feat/handoff-adoption-gate-refatore:agents/sre-agent/AE-HANDOFF-DESIGN.md`, cited as `fork:`.

## Answer

**Partly.** The v1.3.0 agent has an extensions mechanism that can register `aep-mcp-server` as an MCP server, load an `issue-fix` skill, and add standing context. It needs no image change. Four things block or weaken it:

1. **The stock chart cannot mount the extensions directory.** The mechanism reads files from `/etc/openchoreo/sre-agent/<agent>/`. The v1.3.0 `openchoreo-observability-plane` chart has no `extraVolumes`/`extraVolumeMounts`, and its `rca` values schema rejects unknown keys. Helm values, Secret and env alone cannot deliver the files. Something outside the chart must add the volume: a Helm post-renderer, a post-install patch, or an upstream chart PR.
2. **Auth needs HTTPS and a static token.** Extension MCP servers get only static headers, taken from env vars. Headers are refused over plain `http://`. The agent's own OAuth2 client-credentials auth is not used for extension servers. In-cluster `aep-mcp-server` is plain HTTP and forwards whatever bearer it receives. It therefore needs AE-side changes: TLS, and a long-lived credential it can verify, or its own service identity toward aep-api.
3. **No deterministic post-RCA stage.** The closest hook is the remediation agent, which runs after RCA with the RCA report as input. Its built-in prompt says "Do not attempt to execute or apply any actions". Whether the handoff happens is up to the model, steered by `CONTEXT.md` plus the skill. Nothing the patched agent forced in code is forced any more: the classification, dedupe key, labels and dispatch switch.
4. **Reports cannot be pushed; AE must pull.** The stock agent writes reports only to its own SQL backend and has no sink or webhook. It does expose an authenticated read API: REST `GET /api/v1/rca-agent/reports` plus `/{reportId}`, and the MCP tools `list_rca_reports`/`get_rca_report`. AE can poll that.

Achievable with no OC code change: issue search, create and dispatch, driven by the model, on the remediation agent; and RCA report ingestion by pull. Not achievable: a deterministic, code-gated handoff; the handoff outcome recorded on the OC report; report push; and wiring through public chart values only.

## 1. What the v1.3.0 extension mechanism is

Source: `oc:agents/sre-agent/src/extensions/{config,runtime,skills}.py`, `src/agent/agent.py`, PR #4743.

| Aspect | Behaviour | Source |
|---|---|---|
| Root dir | `settings.extensions_dir`, default `/etc/openchoreo/sre-agent`; env `EXTENSIONS_DIR` (pydantic settings, case-insensitive) | `src/config.py:38` |
| Per-agent subdir | `<root>/<agent_name>/`; agent names are `rca`, `remediation`, `chat` | `extensions/config.py:164-165`; `agent/agent.py:126,154,177` |
| `mcp.json` | `{"mcpServers": {name: {url, type?, headers?}}}`. Transport `http`/`streamable_http` only; `url` required | `extensions/config.py:57-101` |
| Header rule | Headers over a non-`https://` URL raise an error. `${VAR}` in header values resolves from env; an unset var raises an error | `extensions/config.py:91-100, 45-54` |
| Auth object | None. The connection dict is `{transport, url, headers}` only. The agent's OAuth2 `auth` is used only for the built-in OpenChoreo/observer MCP servers | `extensions/config.py:90`; `extensions/runtime.py:53-56` vs `agent/agent.py:76-78` |
| Tool names | Prefixed `<server>_<tool>`, so a server keyed `aep` gives `aep_ae_create_issue` | `extensions/runtime.py:55`; langchain-mcp-adapters 0.3.2 `tools.py:516-518` |
| Tool filter | External tools bypass the built-in allow-list. Every tool the server lists is given to that agent | `agent/agent.py:79,89-90`; PR #4743 body |
| Skills | `skills/<name>/SKILL.md` only (any other non-dot file is an error), with frontmatter `name` equal to the dir name, plus `description`. Name and description go in the prompt; the body comes from the `load_skill` tool | `extensions/config.py:104-146`; `extensions/skills.py:21-41` |
| `CONTEXT.md` | Rendered into the system prompt under "Additional Context … They are important, so follow them." A warning is logged over 8 KiB | `extensions/config.py:149-161`; `templates/prompts/remed_agent_prompt.j2:125-127` |
| When loaded | Re-read from disk on every `Agent.create()`, so on every analysis. MCP discovery also runs per analysis, with a 10 s timeout per server | `agent/agent.py:89`; `extensions/runtime.py:25,59-74,96-97` |
| Failure mode | A malformed config or missing env var means extensions are ignored for that agent. An unreachable server is skipped. The RCA still runs | `extensions/runtime.py:88-93,64-74` |

A ConfigMap volume's `..data`/timestamp entries start with `.`, which the skill loader skips (`config.py:109,121`). A ConfigMap using `items[].path` such as `remediation/skills/issue-fix/SKILL.md` therefore produces a valid tree.

## 2. Where the handoff can run, and how it is steered

The pipeline is fixed in code (`agent/agent.py:284-385`): RCA agent → optional remediation agent → `upsert_rca_report`. There is no third stage.

| Placement | Pros | Cons |
|---|---|---|
| **`remediation/`** (recommended) | Runs after RCA. Its input is the RCA report JSON, which includes `alert_context.alert_id`, `component`, `project` and `environment` (`models/rca_report.py:46-67`). It decides which actions are `revised` (config) and which are `suggested` (code), which is the same config-vs-code signal the patched agent derived. Upstream intends it as the agent that "acts" (PR #4743 remarks) | Runs only when `REMED_AGENT=true` (chart `rca.remedAgent`, default `true`, `values.yaml:1478`) **and** the result is `RootCauseIdentified` (`agent.py:335`). The prompt conflicts: "Do not attempt to execute or apply any actions" and "And nothing else" (`remed_agent_prompt.j2`, CONSTRAINTS). `recursion_limit=50` (`agent.py:173`). Failures are swallowed, so an issue can exist while the report lacks the remediation (`agent.py:373-374`) |
| `rca/` | Always runs | Runs *before* remediation, so config-vs-code is not decided yet. Upstream treats the RCA agent as read-only (PR #4743 remarks). Write tools would sit inside the telemetry loop, which reads untrusted logs |
| `chat/` | none | Gives write tools to an interactive, user-driven chat. Keep it empty |

Steering is prompt-only:

- `remediation/CONTEXT.md` should say, in short: after finalising `recommended_actions`, if any action stays `suggested` because the fix belongs in the image, call `load_skill("issue-fix")` and follow it. Otherwise call no `aep_*` tool. It should also explicitly override the "do not execute" constraint for the `aep_*` tools only.
- The skill tells the agent how to search, dedupe, file one issue and dispatch.

This has to be tested against the target OpenAI-compatible model. The model can ignore the override or call the tools when it should not.

### `issue-fix/SKILL.md` must be rewritten

The current skill (`ae:services/aep-mcp-server/skills/issue-fix/SKILL.md`) assumes the patched agent:

- It says "You're invoked only when…" (lines 8-11). In the patched agent, code decided that before the skill ran; now the model must classify for itself.
- It relies on `dedupeKey` and the `sre-agent` label being "attached automatically" (lines 102-107). The patched `_wrap_create_issue` did that (`fork:` §B4); stock does not.
- It says to dispatch "if your instructions say to" (lines 114-121). The patched agent drove this with `AE_AUTO_DISPATCH` (`ae:tools/aectl/cmd/sre.go:226-231`); stock has no such variable.
- It asks for structured output fields (`created_issue_number`, `deduped`, `rationale`) that no stock `response_format` has. The remediation output is `RemediationResult` (`models/remediation_result.py`).
- It names unprefixed tools. They must become `aep_ae_*` (or whatever the server key is).
- It has no alert id in the issue, which AE needs to correlate the issue with the report it pulls later (§4).

Better: move the rules that must hold into `aep-mcp-server`/aep-api, where the model cannot skip them. That means deriving the dedupe key server-side from project, component and alert rule; always applying the `sre-agent` label; validating the component; and gating auto-dispatch in org settings. The skill then carries only guidance.

### Drift to note

AE main's `aep-mcp-server` still exposes three tools (`ae_search_related_issues`, `ae_create_issue`, `ae_dispatch_coding_agent`: `ae:services/aep-mcp-server/src/server.ts:49-149`) and the `issue-fix` skill. The fork's latest design has already moved to two tools, per-run identity headers, a `coding-agent-handoff` skill and a webhook report sink (`fork:` §2, §B2, §B6, §13). This research targets what AE main serves today.

## 3. Auth between the agent and aep-mcp-server

Current state:

- `aep-mcp-server` rejects a request without `Authorization` (`ae:services/aep-mcp-server/src/main.ts:49-55`).
- It forwards that value to aep-api as-is (`aepClient.ts:70-75`).
- aep-api accepts the RCA agent's Thunder client-credentials token because `JWT_AUDIENCE` includes `openchoreo-rca-agent` (`ae:deployments/helm-charts/platform/templates/aep-api/deployment.yaml:85-90`; `fork:` §9).
- The patched agent sent that OAuth2 token (`fork:` §2 decision 3).
- `aep-mcp-server` is a plain-HTTP ClusterIP service on port 3400 (`ae:deployments/helm-charts/platform/templates/aep-mcp-server/`).

With stock extensions:

1. **No OAuth2 for extension servers**, only static headers from env (§1). A client-credentials token expires, and env values are fixed at pod start (`${VAR}` is resolved from `os.environ`), so a minted token in env stops working at expiry. A literal token written into a Secret-mounted `mcp.json` would be re-read per analysis, so an AE-side refresher could rotate it without a restart. That still depends on the mount from §5.
2. **HTTPS is mandatory once any header is set** (`extensions/config.py:95-99`). The target needs TLS. For a private CA, the Python process must trust it via `SSL_CERT_FILE` (httpx 0.28.1 honours it: `httpx/_config.py:34-35`). That file also needs a mount, and it replaces the default trust store for the whole process, including LLM and OAuth calls, so it must be a full bundle. `TLS_INSECURE_SKIP_VERIFY` is not applied to extension clients (`runtime.py:53-56` uses the adapter's default httpx factory).
3. **Recommended AE-side change:** `aep-mcp-server` verifies a dedicated per-plane credential presented by the SRE agent: a long-lived, revocable, org-bound key, stored hashed in AE and delivered to the agent through the ESO-managed `rca-agent-secret`, which the chart loads via `envFrom` (`deployment.yaml:67-69`). It then calls aep-api with its own service identity for the bound org, instead of passing the caller's token through. This removes the static-JWT problem and ties the credential to one org, in line with map #2's "one SRE agent per observability plane, using the plane's owning org". It needs TLS on `aep-mcp-server` (in-cluster cert, or through the AE gateway).

Rejected alternative: plain HTTP with no header, trusting the network (a NetworkPolicy allowing only the sre-agent pod). Anything reachable on that path could file issues and dispatch coding runs, with no identity to audit. Do not do this.

## 4. RCA reports: push is not possible; AE must pull

- The stock agent persists reports only through `report_backend.upsert_rca_report` (SQLite or PostgreSQL: `agent.py:376-385`; `config.py:34-35`). There is no sink, webhook or completion callback. The fork's `REPORT_SINK` was never upstreamed (`fork:` §13).
- A "publish report" MCP tool called by the model is possible, but the model would have to restate the whole report. That is slow, can lose data, and the text comes from a model that reads untrusted logs. Not recommended.
- **Pull API (stock, authenticated):**
  - `GET /api/v1/rca-agent/reports?namespace=&project=&environment=&startTime=&endTime=[&status=&limit=&sort=]` needs `require_authn` plus `rcareport:view` on the project (`src/api/report_routes.py:48-87`; `src/auth.py:15-19`).
  - `GET /api/v1/rca-agent/reports/{reportId}` needs authn plus a per-result `rcareport:view` check (`report_routes.py:90-116`).
  - The same data is available as MCP tools `list_rca_reports`/`get_rca_report` on the agent's `/mcp` (`src/mcp_server.py:184-280`).
  - Summaries carry `alertId`, `reportId`, `status` and `summary`.
- **Pull shape for AE:**
  - Listing is scoped to one project and environment, so AE polls each (project, env) it owns, or polls on a trigger.
  - Correlation key: the skill puts the alert id in the issue body and dedupe key. AE then lists a time window and matches `alertId`, or polls `/{reportId}` if it has recorded one.
  - `report_id` is `<alertId>_<unix-ts>` (`agent_routes.py:91-92`), and the agent never sees it: it is not in `rca_request.j2`.
  - The issue is filed *during* remediation, but the report reaches `completed` only afterwards (`agent.py:376`). AE must poll until status is `completed` or `failed`.
- **Access:**
  - In-cluster, AE calls `http://sre-agent.<obs-ns>:8080`. v1.3.0 enables a NetworkPolicy that limits ingress to the release namespace (`values.yaml:68-94`; `templates/networkpolicy.yaml`), so AE needs a `networkPolicy.additionalIngress` rule. That one is a values knob.
  - Alternatively, go through the chart HTTPRoute, which exposes `/api/v1/rca-agent/reports` and `/mcp` (`templates/sre-agent/http-route.yaml:27-41`, when `gateway.enabled` and `rca.http.enabled`).
  - The AE principal needs a ClusterAuthzRole with `rcareport:view`, bound the way `rca-agent-dispatch` is today (`ae:tools/aectl/cmd/sre_assets.go:228-249`).
- **aep-api contract gap:** `POST /rca-agent/reports` today requires flat fields: project, title, summary, diagnosis, classification (`ae:services/aep-api/internal/ops/createreport/handler.go:66-110`). Stock reports have none of these. AE needs an ingest step that maps the upstream `RCAReport` document; the fork's `native.go` approach (`fork:` §13.2) is not on AE main. It also needs a place to join in the issue number and dispatch state it learns from its own MCP calls.
- **Push-ish trigger (optional):** an `ObservabilityAlertsNotificationChannel` of type `webhook` (`oc:api/v1alpha1/observabilityalertsnotificationchannel_types.go:21-22,127-138`) fires at alert time, in parallel with RCA (`oc:internal/observer/service/alerts.go:420-435`). It could wake AE's poller. `AlertDetails` has no alert-id field (`oc:internal/observer/types/alerting.go`), so whether the payload can carry the alert id is **unverified**.

## 5. Config shape

Files, one ConfigMap (plus a Secret for the credential):

```
<EXTENSIONS_DIR>/            # e.g. /etc/sre-agent-extensions (see nesting note)
  remediation/
    mcp.json
    CONTEXT.md
    skills/issue-fix/SKILL.md
  # rca/ and chat/ deliberately absent
```

`remediation/mcp.json`:

```json
{ "mcpServers": { "aep": {
    "type": "streamable_http",
    "url": "https://aep-mcp-server.<ae-ns>.svc.cluster.local:3400/mcp",
    "headers": { "Authorization": "Bearer ${AEP_MCP_TOKEN}" } } } }
```

Env: `AEP_MCP_TOKEN` comes from `rca-agent-secret` (already ESO-managed, loaded via `envFrom`). `EXTENSIONS_DIR` can be set via `rca.extraEnvs` (`values.yaml:1693`; `deployment.yaml:72-75`; the schema allows `valueFrom` because items do not set `additionalProperties:false`).

Mount: **not available from the chart.**

- `templates/sre-agent/deployment.yaml:97-119` mounts only `observer-auth-config` at `/etc/openchoreo`, plus the sqlite PVC.
- `values.schema.json:1885-1886` sets `rca.additionalProperties: false`.
- `openchoreo/openchoreo` `main` has the same template.
- PR #4743 touched no observability-plane chart file. The only chart file it touched was the control-plane `values.yaml`.

Options, from least to most drift:

1. **Upstream chart PR** adding `rca.extensions` (a ConfigMap name, rendered at `/etc/openchoreo/sre-agent`) or generic `rca.extraVolumes`/`extraVolumeMounts`. This is the proper fix, but it is an OC change. The map allows it only as a later version bump.
2. **Helm post-renderer** in `aectl sre install` that adds the volume and mount to the `sre-agent` Deployment. It is declarative and re-applied on every `helm upgrade`, and the chart and image stay stock. Caveat: aectl calls the `helm` CLI (`ae:tools/aectl/cmd/sre.go:398-416`) and supports Helm v4. As far as I know, Helm 4 made post-renderers plugins rather than executables (not verified here), which affects how aectl ships one.
3. **Post-install strategic-merge patch** (AE's current pattern: `sre.go:214-236`; `skills/README.md:32-36`). Every `helm upgrade` reverts it, so it drifts. Avoid.

Nesting note: the default `/etc/openchoreo/sre-agent` lies inside the read-only `observer-auth-config` mount at `/etc/openchoreo`. A nested mountpoint in a read-only ConfigMap volume may fail to create; not tested here. Pointing `EXTENSIONS_DIR` at a separate path avoids the question.

## 6. Security concerns

- **Prompt injection to write actions.** The model reads pod logs, and the handoff tools are now called entirely at its discretion. Enforce in `aep-mcp-server`/aep-api what used to be forced in code:
  - dedupe key and labels;
  - component resolution (already server-side: `fork:` §5);
  - an org-level auto-dispatch switch (replacing `AE_AUTO_DISPATCH`);
  - rate limits per alert rule.
  - Keep ADR-0018's confidence gate as the human merge gate.
- **External tools bypass the tool allow-list.** Every tool `aep-mcp-server` lists is exposed. Keep that server's tool list minimal: search, create, dispatch.
- **Credential.** Use a per-plane, org-bound, revocable key, never a user JWT. Keep it in a Secret via `${VAR}`, never literal in a ConfigMap. `aep-mcp-server` must not log it (today it logs `String(err)` only: `main.ts:84`).
- **`/analyze` is unauthenticated** in the stock agent (`agent_routes.py:75-79`: no `require_authn`). Only the NetworkPolicy and the absence of an HTTPRoute rule protect it. Anyone in the obs namespace can trigger analyses, and with the handoff enabled those analyses can file issues and dispatch coding runs. Keep `networkPolicy.enabled: true` and do not route `/analyze`.
- **TLS trust.** `SSL_CERT_FILE` replaces the process-wide trust store. Ship a full bundle, never a lone private CA.
- **Dev credentials in repo.** `deployments/single-cluster/thunder-resources/86-openchoreo-rca-agent.yaml` and `deployments/scripts/setup-env-for-aectl.sh:569` commit a literal client secret for `openchoreo-rca-agent` (value `openc****`). Fine for dev only; production must use generated secrets.
- **Supply chain.** Switching to the stock `ghcr.io/openchoreo/sre-agent` removes the personal-registry image (`sre.go:98-99`). Still pin it by digest (map #2 "Not yet specified").
- **Naming drift.** aectl restarts `ai-rca-agent` and targets chart `1.0.1-hotfix.1` (`sre.go:96,154,235`). v1.3.0 names the Deployment `rca.name` = `sre-agent` (`values.yaml:1456`).

## 7. Open questions (need an experiment, not more reading)

- Does the target OpenAI-compatible model reliably follow `CONTEXT.md` over the remediation prompt's "do not execute" constraint? Does it call the tools only for `suggested`, code-level actions?
- Does a ConfigMap mounted with nested `items` paths load cleanly? (Code reading says yes; not run.)
- Can the Helm 4 post-renderer plugin model be shipped from `aectl`?
- Can the observer's webhook payload template include the alert id?
