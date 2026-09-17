# SRE-agent → coding-agent handoff

Wire an OpenChoreo alert → AI RCA → GitHub issue → coding-agent PR, end to end.

```
ERROR log → alert rule → observer → sre-agent (RCA → remediation → handoff)
  → aep-mcp-server → aep-api → GitHub issue (filed already adopted)
  → coding-agent Job → PR → platform merges → build → deploy
```

**What to run it against**: [`sre-demo-scenarios.md`](./sre-demo-scenarios.md) —
six requirement sets that produce a real defect for the loop to find, and the one
rule that decides whether the handoff will act on it at all.

> Moved here from the root `README.md`, which linked to this path but never carried
> the file. The RCA/SRE agent runs the vanilla, unforked `ghcr.io/openchoreo/ai-rca-agent`
> image — the personal-registry fork this doc used to describe building is retired (see
> `docs/design/draft/2026-09-17-sre-agent-extensions-handoff.md`).

## Prerequisites

1. Local AEP stack up (`deployments/docker-compose.yml`) and a k3d OpenChoreo with the
   observability plane (`observer`, `opensearch`, `fluent-bit`, `sre-agent`).
2. Both sides share one Thunder (`thunder.openchoreo.localhost:8080`).
3. AEP org connected to GitHub + an Anthropic key in org settings.
4. The target project/components were **created through AEP** and deployed; the OC project
   slug equals the AEP project slug.

## AEP side

```bash
# Start the MCP server (the SRE agent's door into AEP)
cd deployments && docker compose up -d aep-api aep-mcp-server
curl -s http://localhost:3401/healthz    # {"status":"ok"}
```

The remediation agent authenticates to `aep-mcp-server` with a long-lived
static bearer credential (`AEP_MCP_TOKEN` on the mounted `mcp.json`), not a
per-request Thunder-forwarded token — that per-request-token design is
retired (see `docs/design/draft/2026-09-17-sre-agent-extensions-handoff.md`
decision 7). `aep-api` accepts it through its own `SRE_MCP_TOKEN`, which must
hold the same value (`deployments/.env.example`); on the aectl/Helm path both
come from the same `aep-mcp-token` OpenBao secret/ExternalSecret. There is no
`"Inbound JWT verifier"` log line to check for this credential — that
verifier is for user/service JWTs and is unrelated to it. Note also:
`deployments/docker-compose.yml` does not currently wire `SRE_MCP_TOKEN` into
the local `aep-api` container, so on local dev this static-bearer path stays
disabled until that's added — set it by hand (e.g. `docker compose run -e
SRE_MCP_TOKEN=... aep-api`) if you need to exercise it locally.

## Upgrading an existing deployment

The SRE agent now reaches AEP purely through OpenChoreo's generic extensions
mechanism (`mcp.json`/`CONTEXT.md`/the `coding-agent-handoff` skill, mounted
by `setup-observability.sh`/`aectl sre install` at `EXTENSIONS_DIR/remediation/`
— see "OpenChoreo side" below). If your cluster still carries wiring from
before that — the earlier `HANDOFF_HEADER_MAP`-based fork, or its own even
older `rca-agent-handoff-provider` ConfigMap/volume — none of it is deleted
automatically; neither script deletes resources it no longer manages. See the
"⚠️ UPGRADING AN EXISTING DEPLOYMENT" comment block above step 3e in
`deployments/scripts/setup-observability.sh` for the exact orphaned
resources and the `kubectl delete`/`kubectl edit` commands to clean them up
by hand, once.

## OpenChoreo side

The RCA/SRE agent runs the vanilla, unforked
`ghcr.io/openchoreo/ai-rca-agent:v1.0.1-hotfix.1` image — no fork, no local
build, no `docker build`/`k3d image import`/`kubectl set image` step. Both
install paths pull and wire it automatically:

```bash
bash deployments/scripts/setup-observability.sh   # local k3d dev
# or, against an in-cluster Helm install:
aectl sre install --ae-handoff   # --ae-handoff defaults to true
```

There is no manual `kubectl patch cm rca-agent-config -p
'{"data":{"HANDOFF_ENABLED"...}}'` step either, and no auto-dispatch switch to
flip: filing an issue IS the hand-over, and whether a coding run starts is
what the `ae_create_issue` call answers (adopted / adoptionError /
suppressed), recorded on the RCA report.

What each script does automatically, using OpenChoreo's generic extensions
mechanism (a directory mounted at `EXTENSIONS_DIR`, one subdirectory per
agent — `openchoreo#4743`): it renders `mcp.json` (points the remediation
agent at `aep-mcp-server`, with `AEP_MCP_HOSTNAME`/`AEP_MCP_TOKEN`
substituted), `CONTEXT.md` (the unconditional handoff trigger), and the
`coding-agent-handoff` skill
(`services/aep-mcp-server/skills/coding-agent-handoff/SKILL.md`) into one
`sre-agent-extensions` ConfigMap, and mounts it at
`EXTENSIONS_DIR/remediation/` on the RCA/remediation Deployment. Editing the
skill or `mcp.json`/`CONTEXT.md` and re-running the script picks up the
change with a rollout restart — no image rebuild, ever.

`AEP_MCP_TOKEN` is a long-lived static bearer credential (not a per-request
Thunder-forwarded token — see "AEP side" above); it must be set before
running either script with the handoff enabled (`deployments/.env` locally,
the `aep-mcp-token` OpenBao secret on the Helm path).

**Known limitation: the `aep-mcp-server` route the mounted `mcp.json` points
at doesn't actually work yet.** OpenChoreo's extensions loader refuses a
non-`https://` MCP server URL once `headers` are set, so `mcp.json` hardcodes
`https://${AEP_MCP_HOSTNAME}/mcp`. On the aectl/Helm path, that HTTPS route
(`aep-mcp-mainkgw` HTTPRoute) is wired but sits `Accepted: False`: the
`openchoreo-control-plane` gateway it attaches to has no `https` listener
today (a control-plane-wide change, out of this plan's scope). On the local
k3d path it's worse — there is no cross-namespace route into `aep-mcp-server`
at all; it runs as a plain-HTTP `docker-compose` service the agent's own
`extensions/config.py` cannot reach with a `headers`-bearing config either
way. Until one of those lands, the RCA agent will fail to load the `aep` MCP
server at startup on both paths — this is a real, currently-open gap, not a
"works but slow" situation.

The alert pipeline must actually evaluate rules — this is the step that is commonly broken:

- observability-logs-opensearch module chart >= 0.5.1 (ships the logs-adapter)
- `observer-config`: `LOGS_ADAPTER_ENABLED=true`,
  `RCA_SERVICE_URL=http://sre-agent:8080`, `ALERT_SUPPRESSION_WINDOW=1h`
  (unset suppression ⇒ duplicate issues + dispatches)
- an `ObservabilityAlertRule` scoped to the component (UID + name labels) with
  `actions.incident.enabled` + `triggerAiRca: true`

## Verify

```bash
# Trigger the failure the rule matches, then watch:
kubectl logs -f -n openchoreo-observability-plane deploy/sre-agent | grep -vE "Pydantic V1"
```

Expect, in order: `POST /analyze 200` → `RCA completed` → `Remediation
completed`. The old `Running handoff agent` / `"Handoff completed:
classification=…, issue=…, adopted=True"` lines were the retired fork's own
bespoke handoff-stage code — the vanilla agent has no equivalent of its own,
so don't expect them.

What you should see instead, once at remediation-agent startup, is
OpenChoreo's generic extensions loader confirming the mounted `mcp.json`
connected — per `agents/sre-agent/src/extensions/runtime.py`, something in
the shape of `Loaded N tools from MCP server aep`. **TODO: confirm the exact
wording of that line, and whatever the agent logs (if anything) on a
successful `ae_create_issue` call itself, once Task 8's e2e run has actually
been observed** — this section is deliberately not claiming a verified line
for the per-call case, per the known route limitation above (the MCP server
currently can't even be reached to make that call).

Since the vanilla agent logs nothing bespoke about the handoff's own outcome,
confirm success from the artifacts the call produced, not from the log
stream: `adopted=false` on the RCA report means the issue was filed but
nothing will work it yet (usually: no built version to adopt an incident
into); `classification=none` means the handoff decided no code change was
needed, with its reasoning in the report's own `rationale` field. Neither is
in the log line any more — see the report record itself (or the console's
alert detail).

Then confirm the artifacts: the GitHub issue (carrying the arming label `aep`
and joined to the deployed version's milestone), the `milestone_runs` row for the
incident run adoption started, and the coding-agent PR ("Closes #N"). The platform
merges that PR itself once it resolves the run's milestone work, then builds and
deploys the fix — **unless the fix was not declared high-confidence**, in which
case it waits for a human (below).

## When the same incident comes back

A merged fix closes the issue, which is the platform ASSERTING the incident is
over. When the same error signature recurs, that assertion was wrong, and the
platform retracts it rather than starting a fresh thread (ADR-0032).

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
answer somebody already gave. See ADR-0034.

Holding the merge for a human was the earlier design and is **retired**: in a
project with no test harness the confidence bar can never be met, so it held
every fix and parked every build. See ADR-0033.
