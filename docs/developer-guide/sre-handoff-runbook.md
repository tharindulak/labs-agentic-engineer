# SRE-agent → coding-agent handoff

This flow wires an OpenChoreo observability alert into AE's normal issue-driven
coding-agent dispatch path.

```
observability alert
  → OpenChoreo SRE agent RCA/remediation
  → AE MCP: ae_search_related_issues + ae_create_issue
  → AE-owned GitHub issue classification/adoption
  → existing issue-to-coding-agent dispatch
  → PR, build, deploy, and human verification when required
```

AE owns the issue lifecycle after `ae_create_issue`. The SRE agent does not
dispatch the coding agent directly.

## Runtime pieces

- SRE image: `tharindulak/sre-agent:v1.0.1-hotfix.1-anthropic`.
- Extension root in the SRE pod: `/etc/openchoreo/sre-agent`.
- Remediation extension files:
  - `remediation/CONTEXT.md`
  - `remediation/mcp.json`
  - `remediation/skills/coding-agent-handoff/SKILL.md`
- Canonical skill source:
  `services/aep-mcp-server/skills/coding-agent-handoff/SKILL.md`.
- MCP endpoint: `aep-mcp-server` `/mcp`.
- MCP tools exposed to the SRE agent:
  - `ae_search_related_issues`
  - `ae_create_issue`

`ae_create_issue` is the only write the SRE agent makes. The request must carry
`actionStatuses`, ordered to match the RCA report's recommended actions, using
`"revised"`, `"suggested"`, or `null`.

## Credentials

Anthropic credentials are managed by AE per organization. The Console writes the
org's Anthropic key through the organization credential flow; AE stores the value
in its org secret store and mirrors the secret-ref metadata for runtime
projection.

The SRE hotfix image consumes the key from a file:

```text
RCA_LLM_API_KEY_FILE=/etc/rca-agent/anthropic/RCA_LLM_API_KEY
```

Local setup and `aectl sre install` both mount an optional Kubernetes secret at
`/etc/rca-agent/anthropic`. The key value must not be placed in the image,
checked into config, or logged.

## Local setup

Use the scripted local install:

```bash
cd deployments
bash scripts/setup-observability.sh
```

The script:

1. installs/reconciles the observability plane;
2. uses the hotfix SRE image by default;
3. wires alert suppression (`ALERT_SUPPRESSION_WINDOW=1h`);
4. mounts the AE-owned remediation extension into the SRE pod;
5. wires `RCA_LLM_API_KEY_FILE` to the optional Anthropic secret file; and
6. keeps the MCP bearer token in runtime configuration, not in the image.

Fast local assertions:

```bash
bash deployments/scripts/setup-observability_test.sh
docker compose -f deployments/docker-compose.yml config >/dev/null
```

## Kubernetes setup with aectl

After `aectl init`, install the SRE integration:

```bash
cd tools/aectl
go run . sre install
```

The command reconciles the observability namespace, ExternalSecrets, charts,
SRE extension ConfigMap, and SRE deployment mounts. It uses the same extension
layout as local setup and patches the SRE deployment with:

- `EXTENSIONS_DIR=/etc/openchoreo/sre-agent`
- `RCA_LLM_API_KEY_FILE=/etc/rca-agent/anthropic/RCA_LLM_API_KEY`
- `AEP_MCP_URL=http://aep-mcp-server.<aep-namespace>.svc.cluster.local:3400/mcp`
- optional `AEP_MCP_TOKEN` from the `aep-mcp-token` secret

Focused check:

```bash
cd tools/aectl
go test ./cmd -run 'SRE|Extensions'
```

## Issue outcomes

AE classifies and acts on the issue server-side:

- `code_level` / `mixed`: AE adopts the issue into the normal task funnel and
  dispatches the coding agent when the issue is armed.
- `config_level` / `none`: AE records the issue without dispatching code work.
- `provision` kind: acts as a dispatch brake.
- Low-confidence coding-agent result: the issue remains open/disarmed and the
  Console surfaces `unverified_fix` for human review.
- `not_planned`: the coding agent closes the issue when no code fix is possible
  or warranted; recurrence stops for that signature and the Console surfaces
  `no_change_verdict`.
- Recurrence attempt 4 or later: AE reopens/updates the issue and surfaces
  `escalated` for loud human attention.

Related incident alerts are deduplicated by the server-owned incident key and
the observability alert suppression window. Search results are context only;
the create response decides dedupe, suppression, recurrence, adoption, and
dispatch.

## Console surfaces

- Alert detail shows the SRE stage progression and any linked GitHub issue.
- Project → Issues lists the server-provided issue state, labels, URL, and
  attention reason.
- The notification bell includes SRE attention items for alert-linked issues
  with `unverified_fix`, `no_change_verdict`, or `escalated`.
