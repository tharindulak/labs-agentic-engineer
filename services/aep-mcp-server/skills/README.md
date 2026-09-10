# aep-mcp-server skills — canonical source of truth

These `SKILL.md` files are **owned by AEP** and consumed by the OpenChoreo
SRE/RCA agent, which drives the handoff MCP tools this server exposes
(`ae_search_related_issues`, `ae_create_issue`).

They live here — next to the MCP surface whose contract they describe — and
**not** in the repo-root `skills/` agent library, so AEP's own skill reconcile
does not inject them into AEP's coding/design agents.

## coding-agent-handoff

`coding-agent-handoff/SKILL.md` tells the SRE agent's handoff sub-agent how to
search for related GitHub issues and file the one issue that hands a code-level
root cause over, with RCA context and cross-links. It deliberately does NOT
classify the incident — code-level / config-level / mixed is derived by AEP from
the remediation agent's action statuses, which travel as a header the model
never sees (`x-aep-handoff-action-statuses`), so the model is never asked to
restate data it was handed, nor to re-decide whether it belongs here. Deduplication is likewise not the model's: AEP derives the key
server-side, so the skill's rule is to file and let the receiver decide what
happens next. Filing the issue IS the handoff, but adoption, suppression,
recurrence reopening and any later issue activity are AE's code paths, not the
skill's. Its content is AEP's contract (the `sre-agent` label, dedupe keys, and
what `ae_create_issue` answers back), so it belongs with AEP.

## How it reaches the SRE agent (deploy-time mount)

The SRE agent does not bake this skill into its image and does not fetch it at
runtime. Instead the skill is **materialized at deploy time**:

1. The skill folder is rendered into a ConfigMap
   (`rca-agent-skill-coding-agent-handoff`, one key per file) in the agent's
   namespace.
2. The ConfigMap is mounted into the agent pod at
   `/etc/rca-agent/skills/coding-agent-handoff/`.
3. The agent's `EXTERNAL_SKILLS_DIR=/etc/rca-agent/skills` makes its loader read
   the mounted copy (searched before its built-in `src/skills` library).

This wiring is done by **`deployments/scripts/setup-observability.sh` step 3d**
(gated on `AE_HANDOFF=true`), which reads this folder, renders the ConfigMap, and
strategic-merge-patches the `ai-rca-agent` Deployment with the volume, mount,
and `EXTERNAL_SKILLS_DIR`. Edit the skill here, re-run that script (or just
re-apply the ConfigMap) and restart the agent — no SRE image rebuild.

> Edit this file, not any copy on the agent side. There is no committed copy in
> the SRE repo; the only other instance is the transient ConfigMap.

### No citations into this repo

The skill folder reaches the pod and nothing else does (below), so a reference to
anything in AEP's wider tree — an ADR number, a doc path, a package README — is a
pointer the agent cannot resolve and pays tokens to carry. Provenance for the skill's rules
belongs here instead:

- **`not_planned` is a first-class outcome** — [ADR-0023](../../../docs/decisions/ADR-0023-a-cycle-can-end-because-no-code-change-is-possible.md).
  A cycle may end because no code change is possible; the skill states the rule
  without citing it.

`specs/validation/validation-criteria.json` is the exception that is not one: the
skill has the sub-agent write that path INTO the issue body, and the coding agent
reading it does have the repository.

### Every `.md` in the folder reaches the pod

The ConfigMap is rendered with one `--from-file` per `*.md` in the skill folder
and mounted with no `items[]` filter, so **every markdown file in the folder
reaches the agent**, named by its basename. A skill may therefore be split into
sibling reference files — the usual cure for a long skill, pushing reference
behind a pointer — and the pointer resolves in the pod.

Two things stay behind:

- **Non-markdown files.** Rendering the whole directory would base64 any asset
  into the ConfigMap — a 300K diagram is a third of the 1MiB object limit spent
  shipping a picture to an agent that cannot see it. Diagrams and other assets
  may live in the skill folder; they simply do not mount.
- **Subdirectories.** ConfigMap keys cannot hold a `/`, so keep each skill folder
  flat. A pointer into a nested directory resolves to nothing in the pod, and the
  failure is silent — the skill still loads, minus whatever moved.

The same silence applies to anything outside the folder: an ADR, a doc path, a
package README (see above).

A sibling file only earns the split if some branches skip it. Everything every
run needs belongs in `SKILL.md`, where it cannot be missed.
