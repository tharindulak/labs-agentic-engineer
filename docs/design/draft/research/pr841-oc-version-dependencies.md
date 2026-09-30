# Which parts of #841 depend on OpenChoreo 1.3.0?

Resolves [tharindulak/labs-agentic-engineer#15](https://github.com/tharindulak/labs-agentic-engineer/issues/15),
part of [#12](https://github.com/tharindulak/labs-agentic-engineer/issues/12).

Compared `upstream/main` (wso2/labs-agentic-engineer, head `cf2f186f`) against
`origin/refactor-sre-agent` (tharindulak's fork, head `a9739520` — the exact
head of [wso2/labs-agentic-engineer#841](https://github.com/wso2/labs-agentic-engineer/pull/841),
verified with `git rev-parse`). 104 files changed, +9713/-1991.

## TL;DR

- Only **7 files** actually hard-code an OpenChoreo control-plane version
  number: `tools/aectl/cmd/platform.go`, `platform_version_test.go`, `sre.go`,
  `deployments/scripts/setup-env-for-aectl.sh`,
  `deployments/helm-charts/design/sre-agent-install.md`,
  `docs/developer-guide/sre-handoff-runbook.md`, plus test fixtures that
  mechanically inherit those defaults. Everything else (aep-api, contracts,
  console, the platform Helm chart's templates/values, the aectl SRE-install
  logic itself, the extensions bundle) is version-neutral.
- **The https handoff route works on OpenChoreo 1.2.5.** Verified against
  the `openchoreo/openchoreo` source at tags `v1.2.5` and `v1.3.0`: the
  `gateway-default` Gateway CR's `https` listener is byte-identical between
  the two releases and has defaulted to `enabled: true` since at least
  1.2.5. The runbook's claim that "OC ≥ 1.3.0 provides" this listener is not
  supported by the source and should be corrected.
- The `sre-agent-llm-config` merge (`1887081b`) and everything under it (16
  commits, `09675bf9`..`928151e7`) implement a platform-wide SRE LLM config
  design that was fully superseded later on the same branch. None of its
  code (`platform_sre_llm_config`, `SreLlmConfigService`, `SreAgentLlmCard`)
  survives into the final diff — drop all of it, it's already dead.

## Method

```
git fetch origin refactor-sre-agent   # a9739520 (confirmed head of #841)
git fetch upstream main               # cf2f186f
git diff upstream/main...origin/refactor-sre-agent --stat
git diff upstream/main...origin/refactor-sre-agent -- <file>   # per file/hunk
git log --oneline upstream/main..origin/refactor-sre-agent     # commit list
```

For the https-listener question, shallow-cloned
`github.com/openchoreo/openchoreo` at tags `v1.2.5` and `v1.3.0` into a
scratchpad and diffed the control-plane Helm chart's Gateway template and
values directly (see [https route verdict](#https-route-verdict-does-it-work-on-125)).

## Classification

### Version-neutral (no rework needed for a 1.2.5 target)

Confirmed by grepping each file's diff for `1.3.0`/`1.2.5`/`OC_VERSION`/
`minOCVersion` — zero hits in this set.

| Area | Files |
|---|---|
| Console | all 13 changed files under `apps/console/**` (`SreAgentModelRow`, `AiAgentsCard`, settings `queries`/`sreAgent`, mock fixtures/handlers, onboarding/aiSettings test tweaks) |
| Contracts | `packages/contracts/api/v1/openapi.yaml` |
| aep-api | all ~50 changed files under `services/aep-api/**` — `sreagent` reconciler/desired-state/token, `organization` SRE model connection service/repository/migration, `edge/sre_handoff_gate`, `platform/auth/sre_handoff`, `platform/modelconn`, `clients/{kubeobs,kubeauth,thunderapp}`, `config`, `gen/{models,server}_gen.go`, `app.go`, README/design note |
| Docs | `docs/decisions/ADR-0038-*`, `docs/glossary.md`, `docs/developer-guide/sre-handoff-security.md` (architecture description only — no version literal anywhere in its diff) |
| Chart | `deployments/helm-charts/platform/values.yaml`, `templates/aep-api/deployment.yaml`, `templates/aep-mcp-server/{deployment,httproute,networkpolicy}.yaml`, `templates/external-secrets/external-secrets.yaml` — all parameterized by `.Values.sreAgent.*`, no hard-coded OC version, and (per the verdict below) the `httproute.yaml`'s `sectionName: https` mechanism is confirmed to work on 1.2.5 |
| Extensions | `deployments/sre-agent-extensions/README.md`, `remediation/mcp.json` — the `EXTENSIONS_DIR` path change (`/etc/openchoreo/sre-agent` → `/opt/aep/sre-agent-extensions`) tracks the **SRE-agent image** version (stock `v1.3.0`, kept as-is regardless of control-plane target — see note below), not the control plane |
| Scripts | `deployments/README.md` (the `v1.3.0` it mentions is the SRE-agent *image* tag, not gated on control-plane version) |
| aectl (mechanism) | `sre_assets.go`, `sre_extensions.go` (mechanism, not its test's literal fixtures), `sre_helm_plugin.go`, `sre_mcp_url_test.go`, `sre_plane.go`, `sre_postrender.go`/`_test.go`, `sre_secret_test.go`, `sre_seed.go`/`_test.go`, `sre_status.go`, `update.go`/`_test.go`, `go.mod` — the Helm post-renderer, AE-owned Secret push, model seed, and MCP-URL-builder logic are all independent of which OC version they run against |

**Important distinction:** the SRE-agent **image** tag
(`ghcr.io/openchoreo/sre-agent:v1.3.0@sha256:...`) is intentionally decoupled
from the OpenChoreo **control-plane** version — that's the entire premise of
map issue #12 (stock v1.3.0 image on a 1.2.5 control plane). Every place the
diff says `v1.3.0` for the *image* (aectl's `--rca-image-tag` default,
`deployments/README.md`, `sre_extensions_test.go` fixtures, the rendered
Deployment manifests in test fixtures) is correct as-is for the 1.2.5 target
and needs no change. Only the **control-plane** version literals below do.

### 1.3.0-only (control-plane version — needs a 1.2.5 equivalent)

| File | 1.3.0-only content | 1.2.5 equivalent |
|---|---|---|
| `tools/aectl/cmd/platform.go` | `minOCVersion = "1.3.0"` (was `"1.1.1"` on `upstream/main`) | `minOCVersion = "1.2.5"` — the floor this port actually needs, given the https-listener verdict below. (Whether it could go lower than 1.2.5, e.g. 1.2.0, wasn't checked — 1.2.5 is the version this repo already pins and tests against elsewhere.) |
| `tools/aectl/cmd/platform_version_test.go` | `TestVersionAtLeast_MinOCVersion` hard-asserts `versionAtLeast("1.2.5", minOCVersion) == false` and `versionAtLeast("1.3.0", minOCVersion) == true` | Rewrite around the new floor, e.g. assert `"1.2.4"` → false, `"1.2.5"` → true |
| `tools/aectl/cmd/sre.go` | `--obs-plane-version` flag default `"1.3.0"`; the `enforceOCVersion`/`--skip-oc-version-check` call (inherits `minOCVersion` from `platform.go`, so it self-corrects once #1 is fixed) | `--obs-plane-version` default `"1.2.5"` — matches the convention `deployments/scripts/setup-env-for-aectl.sh` already uses (control-plane, data-plane, workflow-plane, **and observability-plane** charts are all pinned to the same `${OC_VERSION}` there; unverified against the actual GHCR package tag — see Unclear) |
| `deployments/scripts/setup-env-for-aectl.sh` | `OC_BRANCH="release-v1.3"` / `OC_VERSION="1.3.0"` (was `release-v1.2` / `"1.2.5"`) | Revert to `OC_BRANCH="release-v1.2"` / `OC_VERSION="1.2.5"`. **Keep** the new `DEV_GATEWAY_TLS_*` variables and the `--set gateway.tls.*` / cert-manager `Certificate` block added alongside this bump — the mechanism they rely on is present in 1.2.5 too (see verdict). One caveat noted under Unclear: the script's `DEV_GATEWAY_CA_ISSUER="cluster-gateway-selfsigned-issuer"` doesn't match the name the chart's `_helpers.tpl` actually renders (`cluster-gateway-ca-issuer`) in *either* version's source — a pre-existing naming risk, not a version dependency. |
| `deployments/helm-charts/design/sre-agent-install.md` | "Requires OC ≥ 1.3.0 (`minOCVersion`, skippable with...)", `--obs-plane-version` default `1.3.0` mention, "OC ≥ 1.3.0" prerequisite bullet | Reword to "Requires OC ≥ 1.2.5"; update the flag-default mention to `1.2.5` |
| `docs/developer-guide/sre-handoff-runbook.md` | Same class of prose, plus a whole **"Migration from a pre-1.3.0 install"** section that says: *"Upgrade OpenChoreo to 1.3.0 first. The stock agent's https handoff route needs the control-plane gateway's https listener, which OC ≥ 1.3.0 provides; `aectl` itself now refuses to install against an older control plane (`minOCVersion`)."* | This section's premise is contradicted by the source (see verdict) — rewrite it. The real floor is whatever `minOCVersion` ends up as (1.2.5), and the https listener needs no upgrade at all. |

### Unclear

- **`--obs-plane-version` / `--obs-logs-version` chart-package versions on GHCR.** The `openchoreo-observability-plane` chart's own `Chart.yaml` in git shows `version: 0.0.0-latest-dev` in both the `v1.2.5` and `v1.3.0` source tags — the real semver-tagged package is published separately (GHCR OCI). I inferred the 1.2.5-equivalent chart version (`"1.2.5"`) from the sibling convention in `setup-env-for-aectl.sh` (which does pin the same `${OC_VERSION}` across control/data/workflow/**observability** planes), and confirmed that convention is unchanged by this PR (the independent `observability-logs-opensearch` chart stays at `0.5.3` in both `upstream/main` and the PR branch — not coupled to `OC_VERSION` at all). But I did not confirm against a live `helm search repo`/GHCR tag listing that a `1.2.5`-tagged `openchoreo-observability-plane` package actually exists and matches. Worth a quick live check before merging PR 2.
- **`DEV_GATEWAY_CA_ISSUER` name.** `setup-env-for-aectl.sh`'s new cert-manager `Certificate` references issuer `cluster-gateway-selfsigned-issuer`, but `install/helm/openchoreo-control-plane/templates/_helpers.tpl`'s `clusterGateway.name` helper (default `"cluster-gateway"`) renders the actual Issuer name in `templates/cluster-gateway/selfsigned-issuer.yaml` as `<name>-ca-issuer` — i.e. `cluster-gateway-ca-issuer` by default, in *both* 1.2.5 and 1.3.0 source. This looks like a naming mismatch in the PR's own script, independent of which OC version is targeted. Flagging rather than fixing (out of this ticket's scope) — worth a live-cluster check (`kubectl get issuer -n openchoreo-control-plane`) during the #16 execution ticket.
- **Full recursive diff of the `openchoreo-observability-plane` chart tree between 1.2.5 and 1.3.0.** I only diffed the specific template the map's issue #3 flagged (`templates/sre-agent/http-route.yaml` — confirmed it gained a new `/mcp` route rule in 1.3.0, absent in 1.2.5; this is OpenChoreo's own route for the SRE agent, separate from AE's `aep-mcp-server` route, and is the concrete instance of the map's "1.3.0 renamed MCP tools and added a new /mcp route" risk). I did not diff every other template in that chart (e.g. values schema for `rca.*`, the HPA/ClusterTrait schema behind the Agent Manager conflict noted in #12) — out of this ticket's scope, but worth a `diff -rq` before implementation if #16 turns up chart-schema surprises.

## https route verdict: does it work on 1.2.5?

**Yes**, based on the `openchoreo/openchoreo` source, not just the AE-side manifests.

Cloned `github.com/openchoreo/openchoreo` at tags `v1.2.5` and `v1.3.0`
(scratchpad `oc-v1.2.5`/`oc-v1.3.0`). Diffed
`install/helm/openchoreo-control-plane/templates/gateway/gateway.yaml` — the
template that renders the `gateway-default` Gateway CR — between the two
tags. The only difference is an unrelated `infrastructure.labels` addition
(1.3.0's new platform-identity-label feature that lets kgateway-rendered
proxy pods carry platform labels — part of the "(Platform Observability)"
changelog entry, unrelated to TLS/routing). The `https` listener block
itself — `protocol: HTTPS`, `hostname`, `tls.mode: Terminate`,
`certificateRefs` — is **byte-identical** in both versions, gated only on
`.Values.gateway.tls.enabled`.

`install/helm/openchoreo-control-plane/values.yaml` shows that value
**defaults to `true`** in both 1.2.5 and 1.3.0 (same placeholder
`hostname: "*.openchoreo.invalid"`, same empty `certificateRefs: []`) — i.e.
the https listener has existed and been on by default since at least 1.2.5;
it is not new in 1.3.0.

The Gateway API primitives #841 adds on the AE side —
`deployments/helm-charts/platform/templates/aep-mcp-server/httproute.yaml`'s
`HTTPRoute` (`parentRefs: gateway-default`, `sectionName: https`) and
`ReferenceGrant` (allowing that cross-namespace `HTTPRoute` to reference the
`aep-mcp-server` Service) — are standard `gateway.networking.k8s.io` v1/v1beta1
resources, unrelated to OpenChoreo's own version.

**Conclusion:** the aep-mcp-server `HTTPRoute`/`ReferenceGrant` should work
unchanged against a 1.2.5 `gateway-default`, and `docs/developer-guide/sre-handoff-runbook.md`'s
claim that "OC ≥ 1.3.0 provides" the https listener is incorrect and should
be corrected when the runbook is reworked for 1.2.5.

**Caveat — not yet run live.** This verifies the Helm **template source**,
not a running 1.2.5 cluster. The `--set gateway.tls.hostname=...`/`--set-json
gateway.tls.certificateRefs=...` overrides and the new cert-manager
`Certificate` bootstrap in `setup-env-for-aectl.sh` (reusing the chart's
`cluster-gateway-ca`/`...-ca-issuer`) still need an actual `make dev-env`
run against OC 1.2.5 to confirm end-to-end — that's the "bar for works" in
issue #12, and is blocked on the next map ticket (#16).

## Commits from the superseded `sre-agent-llm-config` merge (drop entirely)

`git log --oneline upstream/main..origin/refactor-sre-agent` shows one merge
commit on this branch:

```
1887081b Merge branch 'sre-agent-llm-config' into refactor-sre-agent
```

Everything below it in the log — 16 commits, `09675bf9`
("feat(aep-api): add sreLlm section to the /config contract and wire
types") through `928151e7` ("fix(aep-api): identify who acted in sre_llm
audit log lines") — implements a **platform-wide** `platform_sre_llm_config`
entity/repository/migration, `SreLlmConfigService`, and a console
`SreAgentLlmCard`. This design was fully replaced by the **org-scoped**
model-connection design starting at commit `19b85b9c` ("feat(aep-api):
org-scoped SRE model connection replaces the platform SRE LLM config") and
continuing through the rest of the branch.

Verified: grepping the final `upstream/main...origin/refactor-sre-agent`
diff for `platform_sre_llm_config`, `SreLlmConfigService`, and
`SreAgentLlmCard` returns **zero hits** — none of that code survives into
what #841 actually ships. These 16 commits (plus the merge commit itself)
are pure history to drop; nothing from them should be cherry-picked into
either split PR.

## Proposed PR split

Per issue #12's shape ("PR 1 is aep-api, contracts and console, inert until
`SRE_AGENT_*` is set. PR 2 is aectl, charts, scripts and docs."):

### PR 1 — aep-api, contracts, console (≈65 files, both under the 100-file cap)

- All ~50 files under `services/aep-api/**`
- `packages/contracts/api/v1/openapi.yaml`
- All 13 files under `apps/console/**`
- `docs/decisions/ADR-0038-*`, `docs/glossary.md`

**Confirmed inert:** zero OC-version literals anywhere in this set, and the
new aep-api code paths (the `sreagent` reconciler, `SRE_HANDOFF_*` auth
verifier) are gated on `SRE_AGENT_ORG/_NAMESPACE/_DEPLOYMENT/_SECRET` being
set — absent those env vars (which only PR 2's chart sets), the reconciler
and verifier no-op. This PR can be cut from `main` with **no rework** for
the 1.2.5 target.

### PR 2 — aectl, charts, scripts, docs (≈39 files, under the cap)

- `tools/aectl/cmd/sre*.go` + all its tests, `platform.go`,
  `platform_version_test.go`, `update.go`/`update_test.go`, `go.mod`
- `deployments/helm-charts/platform/**` (6 files)
- `deployments/helm-charts/design/sre-agent-install.md`
- `deployments/scripts/{setup-env-for-aectl.sh, setup-sre.sh}`
- `deployments/sre-agent-extensions/{README.md, remediation/mcp.json}`
- `deployments/README.md`
- `docs/developer-guide/{sre-handoff-runbook.md, sre-handoff-security.md}`

**Every 1.3.0-only item lives here** — this is the PR that needs the
1.2.5 rework from the table above before it can be cut.

### Coupling between the two PRs (flagged, not blocking)

- **Seam:** `deployments/helm-charts/platform/values.yaml`'s `sreAgent.*`
  block and `templates/aep-api/deployment.yaml`'s `SRE_AGENT_*` env vars —
  PR 1's aep-api code reads those vars, PR 2's chart sets them. Landing
  order matters (PR 1 first, inert; PR 2 turns it on) but there's no code
  overlap: no single file needs to be split at the hunk level between the
  two PRs.
- **Token handoff:** `services/aep-api/internal/sreagent/token.go` (PR 1,
  mints/stores the per-org handoff token) and
  `deployments/sre-agent-extensions/remediation/mcp.json`'s
  `Authorization: Bearer ${AEP_MCP_TOKEN}` header plus the
  `aep-mcp-server` `httproute.yaml`/`networkpolicy.yaml` (PR 2, the
  consuming side) — no functional coupling risk since PR 1 mints and stores
  a token whether or not PR 2's route exists yet, but worth a one-line
  cross-reference between the two PR descriptions.
- `packages/contracts/api/v1/openapi.yaml` (PR 1) generates into
  `services/aep-api/internal/gen/{models,server}_gen.go` (also PR 1) —
  self-contained, no coupling to PR 2.

## Open items for #16 (execution)

1. Confirm the `openchoreo-observability-plane` GHCR chart actually
   publishes a `1.2.5`-tagged package (Unclear, above).
2. Verify the `DEV_GATEWAY_CA_ISSUER` name against a live-rendered
   `Issuer` (Unclear, above) — independent of OC version, but will break
   the new TLS cert bootstrap either way if wrong.
3. Run `make dev-env` against OC 1.2.5 end-to-end to confirm the https
   route (this ticket verified the template source only, not a live
   cluster).
