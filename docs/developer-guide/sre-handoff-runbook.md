# SRE-agent → coding-agent handoff

Wire an OpenChoreo alert → AI RCA → GitHub issue → coding-agent PR, end to end.

```
ERROR log → alert rule → observer → ai-rca-agent (RCA → remediation → handoff)
  → aep-mcp-server → aep-api → GitHub issue → coding-agent Job → PR (human merges)
  → webhook → build → deploy
```

> Moved here from the root `README.md`, which linked to this path but never carried
> the file. The image tags below are pinned to a personal registry and are the values
> this was last verified against; re-point them at your own build before running.

## Prerequisites

1. Local AEP stack up (`deployments/docker-compose.yml`) and a k3d OpenChoreo with the
   observability plane (`observer`, `opensearch`, `fluent-bit`, `ai-rca-agent`).
2. Both sides share one Thunder (`thunder.openchoreo.localhost:8080`).
3. AEP org connected to GitHub + an Anthropic key in org settings.
4. The target project/components were **created through AEP** and deployed; the OC project
   slug equals the AEP project slug.

## AEP side

```bash
# Start the MCP server (the SRE agent's door into AEP)
cd deployments && docker compose up -d aep-api aep-mcp-server
curl -s http://localhost:3401/healthz    # {"status":"ok"}

# Verify aep-api accepts the RCA agent's token audience (compose default already does)
docker logs aep-api 2>&1 | grep "Inbound JWT verifier"
# expect: "audience":"aep-*,openchoreo-rca-agent"
```

## OpenChoreo side

```bash
# Deploy an RCA-agent image that includes the handoff stage.
# Use the same repo:tag as RCA_IMAGE_REPO:RCA_IMAGE_TAG in
# scripts/setup-observability.sh — tharindulak/sre-agent:hand0ff-new — so a later
# setup-observability.sh re-run picks up this local build instead of pulling.
cd <openchoreo-repo>/agents/sre-agent
docker build -t tharindulak/sre-agent:hand0ff-new .
k3d image import tharindulak/sre-agent:hand0ff-new -c <cluster>
kubectl set image deploy/ai-rca-agent -n openchoreo-observability-plane \
  "*=tharindulak/sre-agent:hand0ff-new"

# Enable the handoff (AE_AUTO_DISPATCH=false → issue-only; a human adopts it later)
kubectl patch cm rca-agent-config -n openchoreo-observability-plane --type=merge -p \
  '{"data":{"AE_HANDOFF":"true","AE_AUTO_DISPATCH":"true","AE_API_URL":"http://host.k3d.internal:3401"}}'
kubectl rollout restart deploy/ai-rca-agent -n openchoreo-observability-plane
kubectl logs -n openchoreo-observability-plane deploy/ai-rca-agent | grep "MCP connection"
# expect: "loaded 102 tools" (99 + the 3 ae_* tools)
```

The alert pipeline must actually evaluate rules — this is the step that is commonly broken:

- observability-logs-opensearch module chart >= 0.5.1 (ships the logs-adapter)
- `observer-config`: `LOGS_ADAPTER_ENABLED=true`,
  `RCA_SERVICE_URL=http://ai-rca-agent:8080`, `ALERT_SUPPRESSION_WINDOW=1h`
  (unset suppression ⇒ duplicate issues + dispatches)
- an `ObservabilityAlertRule` scoped to the component (UID + name labels) with
  `actions.incident.enabled` + `triggerAiRca: true`

## Verify

```bash
# Trigger the failure the rule matches, then watch:
kubectl logs -f -n openchoreo-observability-plane deploy/ai-rca-agent | grep -vE "Pydantic V1"
# expect, in order: POST /analyze 200 → RCA completed → Remediation completed →
#   Running handoff agent → "Handoff completed: classification=…, issue=…, adopted=True"
#   adopted=False means the issue was filed but nothing will work it — the log
#   line names why (usually: no built version to adopt an incident into).
#   classification=none means the handoff decided no code change was needed; its
#   reasoning is the `rationale` on the report, not in this line.
```

Then confirm the artifacts: the GitHub issue (carrying the arming label `aep`
and joined to the deployed version's milestone), the `milestone_runs` row for the
incident run adoption started, and the coding-agent PR ("Closes #N"). The platform
merges that PR itself once it resolves the run's milestone work, then builds and
deploys the fix.
