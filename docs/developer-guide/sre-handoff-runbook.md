# SRE-agent → coding-agent handoff

Wire an OpenChoreo alert → AI RCA → GitHub issue → coding-agent PR, end to end.

```
ERROR log → alert rule → observer → ai-rca-agent (RCA → remediation → handoff)
  → aep-mcp-server → aep-api → GitHub issue (filed already adopted)
  → coding-agent Job → PR → platform merges → build → deploy
```

**What to run it against**: [`sre-demo-scenarios.md`](./sre-demo-scenarios.md) —
six requirement sets that produce a real defect for the loop to find, and the one
rule that decides whether the handoff will act on it at all.

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
# scripts/setup-observability.sh — tharindulak/sre-agent:skill-loader — so a
# later setup-observability.sh re-run picks up this local build instead of
# pulling. (When the preferred tag is neither built nor pullable that script
# walks back through :handoff-provider, :report-sink, :recurrence, :hand0ff-new
# and finally :anthropic-patched, printing what each one costs you.)
# skill-loader and handoff-provider are both published, so the pull path works;
# a local build just takes precedence over it.
#
# Build context is agents/, NOT agents/sre-agent: the Dockerfile pulls in
# siblings from the parent directory.
cd <openchoreo-repo>/agents
docker build -t tharindulak/sre-agent:skill-loader -f sre-agent/Dockerfile .
k3d image import tharindulak/sre-agent:skill-loader -c <cluster>
kubectl set image deploy/ai-rca-agent -n openchoreo-observability-plane \
  "*=tharindulak/sre-agent:skill-loader"

# Enable the handoff. There is no auto-dispatch switch any more: filing IS the
# hand-over, and whether a coding run starts is what the create call answers
# (adopted / adoptionError / suppressed), recorded on the RCA report.
kubectl patch cm rca-agent-config -n openchoreo-observability-plane --type=merge -p \
  '{"data":{"HANDOFF_ENABLED":"true","HANDOFF_API_URL":"http://host.k3d.internal:3401","HANDOFF_PROVIDER_FILE":"/etc/rca-agent/handoff/provider.json"}}'
# The descriptor and the skill are mounted by setup-observability.sh step 3d
# (ConfigMaps + EXTERNAL_SKILLS_DIR). On :skill-loader the mounted skill is the
# stage's entire playbook, so a SKILL.md edit + re-apply needs no image rebuild.
kubectl rollout restart deploy/ai-rca-agent -n openchoreo-observability-plane
kubectl logs -n openchoreo-observability-plane deploy/ai-rca-agent | grep -E "MCP connection|Handoff provider"
# expect: the base tools + the 2 handoff tools the descriptor names, and
# "Handoff provider loaded from /etc/rca-agent/handoff/provider.json"
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
deploys the fix — **unless the fix was not declared high-confidence**, in which
case it waits for a human (below).

## When the same incident comes back

A merged fix closes the issue, which is the platform ASSERTING the incident is
over. When the same error signature recurs, that assertion was wrong, and the
platform retracts it rather than starting a fresh thread (ADR-0021).

What you will see instead of a new issue:

- The original issue **reopened**, with a `## Recurrence <n>` section appended
  carrying the new evidence — so one incident keeps one thread however many
  attempts it takes.
- It **re-homed**: moved out of the settled milestone it was fixed in and into
  the version deployed now, then made agent work again and given a run.
- `reopened: true` and `recurrence: <n>` on the RCA report, which the console's
  alert detail renders as "Attempt n". From attempt 4 it is **escalated** — said
  loudly, on the issue and in the console. Escalation never stops the platform
  working the incident; it asks for a human's attention, not their permission.

Two things never recur: an issue a human closed as **not planned** (the platform
does not overrule that — a fresh issue is filed instead), and one that is not
SRE-filed work. There is no time limit; a signature that resurfaces months later
still reopens its own thread.

## When a fix is not vouched for

A pull request resolving an `sre-agent` issue always merges. What its
`Confidence:` line decides is whether the ISSUE closes behind it:

- `Confidence: high` → the issue closes on merge, as normal.
- `low`, missing or unparseable → the platform reopens the issue, removes `aep`,
  and comments why. That is an **unverified fix**: shipped and recorded, open for
  a human to see, in no run's working set. The run settles and the build proceeds
  — nothing is waiting on you.

What to do with one: if the fix looks right, close the issue. If the incident
recurs, the platform continues that same thread — new evidence appended, the
coding agent put back on it — without you doing anything. If the version moves on
first, supersede closes it.

Spec-build pull requests are outside this entirely.

## When the incident cannot be fixed in code

Sometimes the reported behaviour is what `specs/` REQUIRES — a demo specified to
time out keeps timing out. The coding agent reads the acceptance criteria, and
when no change can help it closes the issue as **not planned** with its
reasoning.

- The **cycle ends** there. No pull request, no two-hour wait, and the run
  settles normally rather than failing with `redispatch-budget`.
- The next alert with the same signature is **suppressed**: nothing filed,
  nothing dispatched, and the RCA report says which issue holds the decision.
- **Disagree?** Reopen the issue. It becomes agent work again and the next alert
  behaves exactly as normal.

If you see an incident recur with no issue filed, look for a closed `not_planned`
issue carrying the same `dedupe:` label — that is the platform pointing at an
answer somebody already gave. See ADR-0023.

Holding the merge for a human was the earlier design and is **retired**: in a
project with no test harness the confidence bar can never be met, so it held
every fix and parked every build. See ADR-0022.
