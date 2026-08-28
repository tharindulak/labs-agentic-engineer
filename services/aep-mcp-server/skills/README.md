# aep-mcp-server skills — canonical source of truth

These `SKILL.md` files are **owned by AEP** and consumed by the OpenChoreo
SRE/RCA agent, which drives the handoff MCP tools this server exposes
(`ae_search_related_issues`, `ae_create_issue`).

They live here — next to the MCP surface whose contract they describe — and
**not** in the repo-root `skills/` agent library, so AEP's own skill reconcile
does not inject them into AEP's coding/design agents.

## issue-fix

`issue-fix/SKILL.md` is the handoff skill: it tells the SRE agent's handoff
sub-agent how to decide whether a root cause needs a source code change, dedupe
against related GitHub issues, and file one issue with RCA context and
cross-links. It deliberately does NOT classify the incident — code-level /
config-level / mixed is derived from that decision plus the remediation agent's
action statuses, so the model is never asked to restate data it was handed. Filing the
issue IS the handoff — AEP adopts what it files — so there is no dispatch step
to describe. Its content is AEP's contract (the `sre-agent` label, dedupe keys,
and what `ae_create_issue` answers back: `deduped`, `adopted`,
`adoptionError`), so it belongs with AEP.

## How it reaches the SRE agent (deploy-time mount)

The SRE agent does not bake this skill into its image and does not fetch it at
runtime. Instead the skill is **materialized at deploy time**:

1. This file is rendered into a ConfigMap (`rca-agent-skill-issue-fix`, key
   `SKILL.md`) in the agent's namespace.
2. The ConfigMap is mounted into the agent pod at
   `/etc/rca-agent/skills/issue-fix/`.
3. The agent's `EXTERNAL_SKILLS_DIR=/etc/rca-agent/skills` makes its loader read
   the mounted copy (searched before its built-in `src/skills` library).

This wiring is done by **`deployments/scripts/setup-observability.sh` step 3d**
(gated on `AE_HANDOFF=true`), which reads this file, renders the ConfigMap, and
strategic-merge-patches the `ai-rca-agent` Deployment with the volume, mount,
and `EXTERNAL_SKILLS_DIR`. Edit the skill here, re-run that script (or just
re-apply the ConfigMap) and restart the agent — no SRE image rebuild.

> Edit this file, not any copy on the agent side. There is no committed copy in
> the SRE repo; the only other instance is the transient ConfigMap.

### No citations into this repo

`SKILL.md` reaches the pod alone (below), so a reference to anything in AEP's
tree — an ADR number, a doc path, a package README — is a pointer the agent
cannot resolve and pays tokens to carry. Provenance for the skill's rules
belongs here instead:

- **`not_planned` is a first-class outcome** — [ADR-0023](../../../docs/decisions/ADR-0023-a-cycle-can-end-because-no-code-change-is-possible.md).
  A cycle may end because no code change is possible; the skill states the rule
  without citing it.

`specs/validation/validation-criteria.json` is the exception that is not one: the
skill has the sub-agent write that path INTO the issue body, and the coding agent
reading it does have the repository.

### One file reaches the pod

The ConfigMap is rendered `--from-file=SKILL.md` and mounted with a single
`items[].path`, so **`SKILL.md` is the only file the agent ever sees**. A skill
split into sibling files — the usual cure for a long skill, pushing reference
behind a pointer — would leave the agent reading a pointer to a path that does
not exist in the pod, and the failure is silent: the skill still loads, minus
whatever moved. Keep each skill's content in its own `SKILL.md`, or extend step
3d to render every file as a ConfigMap key with a matching `items[]` entry first.
