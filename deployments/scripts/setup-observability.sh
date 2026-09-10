#!/bin/bash
# Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
#
# WSO2 LLC. licenses this file to you under the Apache License,
# Version 2.0 (the "License"); you may not use this file except
# in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.

# scripts/setup-observability.sh — installs the OpenChoreo Observability
# Plane (minimum profile: Observer + cluster-agent + OpenSearch + Fluent Bit).
# Required for the in-UI Live Progress panel to stream coding-agent + build
# logs. Without this, the BFF's /progress/agent endpoint returns 503 and the
# UI falls back to "Live progress unavailable — falling back to status polling".
#
# Also wires the SRE (RCA) agent alert→RCA→AEP-handoff pipeline (see
# docs/developer-guide/sre-handoff-runbook.md): logs-adapter (alert-rule
# evaluation), observer auto-trigger config, and the RCA agent's HANDOFF_ENABLED
# env so code-level RCA findings become GitHub issues + coding-agent runs.
#
# Idempotent: re-running is safe — helm install is gated by helm_install_if_not_exists,
# kubectl apply is server-side, and ExternalSecrets / CRs are upserts.
#
# Optional: setup.sh skips this stage unless ENABLE_OBSERVABILITY=1 is set (e.g.
# `ENABLE_OBSERVABILITY=1 bash scripts/setup.sh`), in which case it runs —
# this is the heaviest install (OpenSearch StatefulSet + Fluent Bit DaemonSet
# + RCA agent) and not everyone needs Live Progress streaming or the
# alert→RCA handoff. Run this script by hand later to add it on top of an
# existing setup; start.sh detects its absence and degrades gracefully
# (see stage 7c).
#
# Wiring summary:
#   - Helm: openchoreo-observability-plane @ v1.0.1-hotfix.1
#       Observer + cluster-agent + RCA. Creates HTTPRoute on its OWN
#       gateway (openchoreo-observability-plane/gateway-default, port 11080).
#   - Helm: observability-logs-opensearch @ v0.5.1
#       OpenSearch (storage) + Fluent Bit (DaemonSet, log shipper) +
#       logs-adapter (materialises ObservabilityAlertRules as OpenSearch
#       alerting monitors — 0.3.x had NO adapter, so log alert rules synced
#       but were never evaluated).
#   - ConfigMap patches (post-helm): observer-config auto-trigger keys
#       (LOGS_ADAPTER_ENABLED / RCA_SERVICE_URL / ALERT_SUPPRESSION_WINDOW)
#       and rca-agent-config handoff keys (HANDOFF_ENABLED / HANDOFF_API_URL /
#       HANDOFF_PROVIDER_FILE). Patched after helm so chart
#       upgrades can't silently
#       drop them on re-runs.
#   - Cross-namespace HTTPRoute on the MAIN kgateway
#       (openchoreo-control-plane/gateway-default) for observer.openchoreo.localhost
#       so the BFF in docker-compose can reach the Observer via the same
#       k3d-openchoreo-serverlb:8080 it uses for everything else (the
#       obs-plane's own port-11080 gateway isn't exposed by k3d serverlb).
#   - ExternalSecret: opensearch-admin-credentials, observer-secret
#       Pull username/password/OAuth-client-secret from OpenBao
#       (seeded by single-cluster/values-openbao.yaml postStart hook).
#   - CR: ClusterObservabilityPlane/default registers this plane with the CP.
#   - Job: opensearch-bootstrap-templates — detection + self-heal ONLY. The
#       0.5.x chart's own setup hook owns the container-logs index template
#       (log: wildcard, pod_name + openchoreo_dev/* labels: keyword — the
#       exact mappings the Observer's queries and the logs-adapter's alert
#       monitors depend on). This job verifies the template and deletes any
#       index created under a wrong/older mapping (e.g. the Fluent Bit
#       first-write race) so it's recreated correctly. It must NOT put its
#       own template: a same-name template REPLACES the chart's, and a
#       log:text mapping silently breaks every log-based alert (wildcard
#       patterns then match analysed lowercase tokens — "ERROR" never matches).
#
# Knobs (env):
#   RCA_IMAGE_TAG   SRE-agent image tag to import/run (default: fingerprint-fix).
#                   `fingerprint-fix` is the image for the CURRENT handoff
#                   contract. It carries three things on top of `skill-loader`:
#                     * classification and the dispatch decision both moved to
#                       AE — the stage no longer runs HandoffClassification.derive
#                       in Python, it forwards each remediation action's status
#                       on the create call and answers back whatever
#                       classification AE derived. A config-level report is now
#                       filed too (a ledger entry AE doesn't dispatch) instead
#                       of being skipped;
#                     * the structured `rationale`/`related_issues` report
#                       fields are gone — nothing they said wasn't already in
#                       the filed issue — and the stage runs with no response
#                       schema, ending on the model's own final message;
#                     * the skill catalog is discovered by directory
#                       (`discover_skills`) instead of a hardcoded name, so a
#                       second mounted skill reaches the agent with no image
#                       rebuild;
#                     * the dedupe fingerprint is hashed from the raw captured
#                       logs, not the log lines the model chose to cite in its
#                       report — the same defect triggered repeatedly now
#                       produces one issue instead of one per run;
#                     * a handoff stage that throws now records
#                       `HandoffResult.failed` on the report instead of only
#                       logging, and a missing skill mount is fatal at startup
#                       rather than a per-incident failure.
#                   Published: docker.io/tharindulak/sre-agent:fingerprint-fix
#                   (linux/arm64, as every tag in this ladder is).
#
#                   `skill-loader` is the PREVIOUS tier and still works: it
#                   reads the same descriptor and the same mounted skill, but
#                   still derives its own classification/dispatch decision in
#                   Python and reports `rationale`/`related_issues`. An OLDER
#                   image talking to a newer AE is not the failure mode here —
#                   it is a NEWER AE re-deriving a decision this image already
#                   made, so the two can silently disagree on adoption.
#                   It is `handoff-provider` plus the prompt/skill split: the
#                   agent's handoff prompt is now only a SKILL LOADER — the
#                   run-time scope values and the skill catalog, nothing else.
#                   Every rule the stage follows (how to search, what the issue
#                   must say, what each answer means) comes from the
#                   coding-agent-handoff skill THIS repo owns and step 3d mounts,
#                   so changing the handoff's behaviour no longer needs an SRE
#                   image at all. It also stops the model-visible text naming a
#                   receiver: no persona sentence, and no "GitHub" in the
#                   structured-output schema either.
#
#                   `handoff-provider` is the tier before that and still works: it
#                   reads the same descriptor and the same mounted skill, and its
#                   prompt additionally carries a persona plus its own copy of
#                   what the skill already says. Nothing breaks on it — the
#                   duplication is simply back, and a skill edit no longer fully
#                   determines the stage's behaviour.
#
#                   Older tiers, kept for the record:
#                   `recurrence` was the image for the handoff contract before
#                   the provider descriptor.
#                   It is `hand0ff-new` plus the recurrence half of AEP ADR-0018
#                   ("a merged fix is not a resolved incident"):
#                     * the handoff still makes ONE ae_create_issue call with the
#                       same forced dedupeKey — nothing in this repo decides a
#                       recurrence. AE does, deterministically, by matching that
#                       key against an issue it had already CLOSED as completed;
#                     * the answer now carries `reopened` and `recurrence` (which
#                       attempt this is). Both are stamped onto HandoffResult from
#                       the wire by apply_handoff_facts, never restated by the
#                       model — the same rule `adopted` follows;
#                     * `recurrence` is forwarded on the RCA report
#                       (src/clients/aep_reports.py) so the console's alert detail
#                       can say "Attempt 3" instead of showing a reopened incident
#                       as though it were new.
#                   It also carries the DECLINE GUARD. Declining to file is the
#                   one outcome nothing recovers from, and it was being reached
#                   too easily: an RCA asking to "remove the artificial delay in
#                   service2" was declined wholesale because the delay was
#                   deliberate and AE's own "Implement service2 slow backend"
#                   issue said so. So a decline must now account for EVERY
#                   remaining action (config_handled — checked against the action
#                   really being `revised` — or pure_advice), and one that does
#                   not comes back to the model once with the gaps named. AE's
#                   own planned-work issues also arrive in the search result
#                   flagged `PlatformRecord`, saying they describe behaviour to
#                   PRESERVE and never rule a change out.
#                   An OLDER image still works against a newer AE — it simply
#                   ignores the two new fields, so a recurrence is reopened and
#                   re-dispatched correctly but the REPORT says nothing about it,
#                   and the console shows attempt 3 as if it were attempt 1.
#                   That is the silent failure this tag exists to prevent.
#
#                   `fingerprint-fix`, `skill-loader` and `handoff-provider` are
#                   ALL published, so the registry fallback below can find them.
#                   To build any of them locally instead (the local copy wins
#                   over the registry):
#                     cd <openchoreo-repo>/agents && docker build \
#                       -t tharindulak/sre-agent:fingerprint-fix -f sre-agent/Dockerfile .
#                   The context is agents/, NOT agents/sre-agent — the Dockerfile
#                   pulls in the shared agents/common package.
#
#                   hand0ff-new is the PREVIOUS contract, in
#                   which FILING the issue IS the handoff:
#                     * one AE call — ae_create_issue adopts what it files, so
#                       there is no ae_dispatch_coding_agent and no second leg
#                       that can fail between them (AEP ADR-0017);
#                     * no classification asked of the model. It answers
#                       needs_code_change; code-level / config-level / mixed is
#                       DERIVED from that plus the remediation statuses;
#                     * config work never reaches the coding agent. A
#                       config-only RCA short-circuits before the LLM runs, and a
#                       mixed one has its ReleaseBinding patches withheld from
#                       the payload the model writes the issue from;
#                     * dedupe key, the sre-agent label, the unprefixed design
#                       component name, and the adopt flag are all forced in code
#                       (src/agent/handoff_logic.py), never left to the prompt.
#                   It also carries the two earlier requirements that are easy to
#                   regress: the EXTERNAL_SKILLS_DIR loader, so the AEP-owned
#                   coding-agent-handoff skill mounted by step 3d below is what actually runs
#                   (an image with a baked-in copy IGNORES that mount), and a
#                   configurable HANDOFF_MCP_PATH (default /mcp) so the agent reaches
#                   the standalone aep-mcp-server on :3401 instead of crash-
#                   looping against a hardcoded /sre-mcp.
#                   Requires the rca-agent component:create grant in setup-aep.sh
#                   — the synchronous EnsureComponent pre-check that runs before
#                   the issue is filed 403s without it.
#                   Degradation chain, each step louder than the last:
#                     recurrence → hand0ff-new (handoff works, recurrence
#                     reporting ABSENT) → anthropic-patched (RCA works, handoff
#                     stage ABSENT entirely).
#   HANDOFF_MCP_PATH path of the handoff MCP endpoint under HANDOFF_API_URL
#                   (default: /mcp = standalone aep-mcp-server; set /sre-mcp for
#                   the in-process aep-api surface). Older images than
#                   hand0ff-new hardcode /sre-mcp and ignore this.
#   HANDOFF_ENABLED enable the RCA→platform coding-agent handoff (default: true).
#                   Legacy AE_HANDOFF is still honoured as a fallback.
#                   The handoff files ONE issue for code-level work; AEP adopts
#                   it on creation, which is what puts the coding agent on it.
#   Whether the filed issue is handed to the coding agent (vs. left as a
#                   ledger entry for a human to adopt) is controlled by
#                   AEP_HANDOFF_ADOPT on the aep-mcp-server deployment, not by
#                   anything on the SRE agent side.
#   REPORT_SINK     where completed RCA reports are published (default:
#                   webhook; empty = nowhere, which silently empties the
#                   console Alerts bell/list). Replaced AE_PUBLISH_REPORTS:
#                   the agent no longer knows anything about aep-api's schema,
#                   it POSTs its own report and aep-api maps it.
#   REPORT_SINK_URL FULL URL of the report endpoint, not a base — the sink
#                   posts exactly here
#                   (default: http://host.k3d.internal:9090/api/v1/rca-agent/reports).
#                   Replaced AEP_API_URL. Distinct from HANDOFF_API_URL, which is the
#                   MCP server on :3401.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
source "$SCRIPT_DIR/env.sh"
source "$SCRIPT_DIR/utils.sh"

OBS_PLANE_VERSION="1.0.1-hotfix.1"
# >= 0.5.1 REQUIRED for the logs-adapter (alert-rule evaluation engine).
# 0.3.x ships no adapter: ObservabilityAlertRules sync as Ready but are
# never evaluated — no alert ever fires, silently.
OBS_LOGS_VERSION="0.5.1"
NS="openchoreo-observability-plane"

# SRE-agent handoff knobs (see header). HANDOFF_API_URL is how the in-cluster RCA
# agent reaches the docker-compose-hosted aep-mcp-server on the host.
HANDOFF_ENABLED="${HANDOFF_ENABLED:-${AE_HANDOFF:-true}}"
HANDOFF_API_URL="${HANDOFF_API_URL:-${AE_API_URL:-http://host.k3d.internal:3401}}"
# What this agent's OWN vocabulary for a run's context maps onto, on the wire.
# JSON object, field name -> header name; the field names are this agent's
# (project, component, signature, action_statuses), the header names are
# whatever the configured receiving platform expects. No file to mount: the
# operator deploying AE alongside this agent sets the values that match AE's
# own header constants (services/aep-mcp-server/src/handoffContext.ts).
HANDOFF_HEADER_MAP="${HANDOFF_HEADER_MAP:-{\"project\":\"X-AEP-Incident-Project\",\"component\":\"X-AEP-Incident-Component\",\"signature\":\"X-AEP-Incident-Signature\",\"action_statuses\":\"X-AEP-Handoff-Action-Statuses\"}}"
# Report publishing: the agent POSTs each completed report to a configured sink
# and aep-api maps it onto its own row. REPORT_SINK_URL is the FULL endpoint —
# the sink posts exactly there, it does not append a path — and is distinct from
# HANDOFF_API_URL (the MCP server on :3401); reports go to the HTTP API on :9090.
REPORT_SINK="${REPORT_SINK:-webhook}"
REPORT_SINK_URL="${REPORT_SINK_URL:-http://host.k3d.internal:9090/api/v1/rca-agent/reports}"

echo "=== Installing OpenChoreo Observability Plane ==="

kubectl cluster-info --context $CLUSTER_CONTEXT &>/dev/null || {
    echo "❌ Cluster '$CLUSTER_CONTEXT' not running. Run: ./setup-k3d.sh && ./setup-prerequisites.sh && ./setup-openchoreo.sh"
    exit 1
}

# ── 1. Namespace + ExternalSecrets (pulled from OpenBao) ─────────────────
echo ""
echo "1️⃣  Namespace + ExternalSecrets"
kubectl --context "$CLUSTER_CONTEXT" create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
# The observability-plane chart mounts the cluster-gateway-ca ConfigMap into
# its cluster-agent pod but does not create it (same as the DP/WF charts).
# Without this the cluster-agent pod sits in ContainerCreating forever with
# `MountVolume.SetUp failed for volume "server-ca" : configmap "cluster-gateway-ca" not found`.
# Mirrors create_plane_cert_resources calls for openchoreo-{data,workflow}-plane
# in setup-openchoreo.sh.
create_plane_cert_resources "$NS"
kubectl --context "$CLUSTER_CONTEXT" apply -f - <<EOF
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: opensearch-admin-credentials
  namespace: $NS
spec:
  refreshInterval: 1h
  secretStoreRef:
    kind: ClusterSecretStore
    name: default
  target:
    name: opensearch-admin-credentials
  data:
    - secretKey: username
      remoteRef: { key: opensearch-username, property: value }
    - secretKey: password
      remoteRef: { key: opensearch-password, property: value }
---
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: observer-secret
  namespace: $NS
spec:
  refreshInterval: 1h
  secretStoreRef:
    kind: ClusterSecretStore
    name: default
  target:
    name: observer-secret
  data:
    - secretKey: OPENSEARCH_USERNAME
      remoteRef: { key: opensearch-username, property: value }
    - secretKey: OPENSEARCH_PASSWORD
      remoteRef: { key: opensearch-password, property: value }
    - secretKey: UID_RESOLVER_OAUTH_CLIENT_SECRET
      remoteRef: { key: observer-oauth-client-secret, property: value }
EOF
echo "✅ ExternalSecrets applied"

# ── 1b. RCA (SRE) agent image + secret ───────────────────────────────────
# The RCA agent runs the patched image (Anthropic ToolStrategy fix). It's a
# locally-built image, so import it into the k3d cluster (a cluster rebuild
# loses imported images — this makes the import part of setup). Build once with
# (repo:tag must match RCA_IMAGE_REPO:RCA_IMAGE_TAG below so this local build is
# picked up instead of a registry pull):
#   cd <openchoreo-repo>/agents && docker build \
#     -t tharindulak/sre-agent:fingerprint-fix -f sre-agent/Dockerfile .
# The context is agents/, NOT agents/sre-agent: the Dockerfile pulls in the
# shared agents/common package (openchoreo PR #4372), so building from inside
# sre-agent/ cannot resolve its COPY paths.
# `recurrence` additionally reports which attempt an incident is on (ADR-0018):
# it stamps `reopened` + `recurrence` from ae_create_issue's answer onto the
# HandoffResult and forwards the count on the RCA report. An older image is
# still FUNCTIONAL against a newer AE — recurrences are reopened and worked
# correctly either way, because AE decides that — but the report and console
# then show a third attempt as though it were the first.
# The image must be built from the SRE branch that (a) adds the
# EXTERNAL_SKILLS_DIR loader (src/agent/skills.py + src/config.py), (b) removes
# the baked-in src/skills/coding-agent-handoff — without both, step 3d's mount is inert —
# (c) makes the handoff MCP path configurable (HANDOFF_MCP_PATH, default /mcp) so the
# boot MCP test reaches the standalone aep-mcp-server on :3401, and (d) carries
# the one-call handoff: ae_create_issue with adopt/componentName, and no
# ae_dispatch_coding_agent (an older image still calls a tool aep-mcp-server no
# longer exposes).
# The agent reads its LLM key + OAuth client secret from the rca-agent-secret
# Secret (envFrom). RCA_LLM_API_KEY comes from ANTHROPIC_API_KEY in deployments/.env;
# OAUTH_CLIENT_SECRET must equal the openchoreo-rca-agent client secret registered
# by the Thunder bootstrap (values-thunder.yaml CONFIDENTIAL_APPS).
echo ""
echo "1️⃣b RCA agent image + secret"
# Preferred tag `fingerprint-fix` (= RCA_IMAGE_TAG default below) carries
# everything `skill-loader` did — the prompt/skill split (handoff prompt is a
# loader, the mounted skill is the whole playbook), the one-call handoff stage
# (HANDOFF_ENABLED), the EXTERNAL_SKILLS_DIR loader that reads the AEP-mounted
# coding-agent-handoff skill from step 3d, the configurable HANDOFF_MCP_PATH
# (default /mcp), the recurrence contract (ADR-0021), the provider descriptor
# (HANDOFF_PROVIDER_FILE) and the report sink — plus: classification and the
# dispatch decision both moved to AE (this stage no longer re-derives either),
# skill discovery by directory (a second mounted skill needs no image rebuild),
# and a dedupe fingerprint hashed from raw captured logs instead of the
# model's cited lines, so one repeated defect produces one issue, not one per
# run. With this image, editing
# services/aep-mcp-server/skills/coding-agent-handoff/SKILL.md and re-running
# step 3d changes the stage's behaviour completely, with no SRE image rebuild.
# STILL REQUIRES REPORT_SINK / REPORT_SINK_URL, or reports go nowhere and the
# console Alerts list stays empty.
# Resolution order:
#   1. local build            cd <openchoreo-repo>/agents && docker build \
#                       -t tharindulak/sre-agent:fingerprint-fix -f sre-agent/Dockerfile .
#      (preferred — developers iterating on the agent aren't surprised by a
#       stale registry copy)
#   2. registry pull          ${RCA_IMAGE_PULL} (Docker Hub mirror)
#   3. local skill-loader     (older tier: needs the provider-descriptor mount
#                              step 3d no longer creates — handoff stage fails
#                              to start; RCA itself is unaffected)
#   4. local handoff-provider (older tier: same descriptor dependency as
#                              skill-loader — handoff stage fails to start for
#                              the same reason)
#   5. local report-sink      (older: reads the PRE-RENAME AE_* config keys)
#   6. local recurrence       (older contract: handoff works, but publishing
#                              is REJECTED by current aep-api — no Alerts feed)
#   7. local hand0ff-new      (older: also cannot say WHICH ATTEMPT an incident
#                              is on)
#   8. local anthropic-patched (older tag: RCA works, handoff stage ABSENT)
#
# RCA_IMAGE_REPO is the FULLY QUALIFIED name (tharindulak/sre-agent),
# not a short local alias — deliberately. An earlier version used a short repo
# name here and retagged the pulled image to it before `k3d image import`; the
# Deployment then referenced that short, unqualified name. That worked right
# after import, but k3d/containerd's image GC can evict it later — and because
# the reference had no registry/namespace, kubelet's re-pull attempt resolved
# to docker.io/library/<name> (Docker Hub's default namespace for official
# images) instead of our actual image, and failed outright
# (ImagePullBackOff: "pull access denied, repository does not exist"). Using
# the fully-qualified name everywhere means a cache-evicted image can always
# be re-pulled from the real registry — no more silent long-term fragility.
RCA_IMAGE_REPO="tharindulak/sre-agent"
RCA_IMAGE_TAG="${RCA_IMAGE_TAG:-fingerprint-fix}"
RCA_IMAGE_PULL="${RCA_IMAGE_PULL:-tharindulak/sre-agent:${RCA_IMAGE_TAG}}"
# Degradation is EXPLICIT and ordered, because each step down loses something
# different and a silent step-down is what makes a stale agent hard to spot:
#   fingerprint-fix — current contract. Builds on skill-loader: classification
#                    and the dispatch decision are AE's, not this stage's; the
#                    dedupe fingerprint hashes the raw captured logs instead of
#                    the model's cited lines, so one repeated defect files one
#                    issue, not one per run; the skill catalog is discovered by
#                    directory, so a second mounted skill needs no image
#                    rebuild; and a handoff stage that throws records
#                    HandoffResult.failed on the report instead of only
#                    logging. Config keys are HANDOFF_* (see below).
#   skill-loader   — previous tier. The handoff prompt is a LOADER: the
#                    mounted coding-agent-handoff skill is the stage's entire
#                    playbook, so this repo owns the handoff's behaviour outright
#                    and a skill edit needs no SRE image. Tool and argument names
#                    come from a provider descriptor this image expects mounted at
#                    /etc/rca-agent/handoff/provider.json — step 3d no longer
#                    creates that mount (HANDOFF_HEADER_MAP replaced it), so this
#                    tier's handoff stage now fails to start. RCA itself (minus
#                    the handoff) is unaffected.
#   handoff-provider — same descriptor dependency as skill-loader, so its
#                    handoff stage fails to start for the same reason. Its only
#                    remaining difference (a prompt that duplicates the skill's
#                    rules instead of only loading it) is moot once the handoff
#                    cannot start at all.
#   report-sink    — publishes reports fine, but reads the PRE-RENAME config
#                    keys (AE_HANDOFF / AE_AUTO_DISPATCH / AE_API_URL). This
#                    script writes both sets for exactly that reason, so the
#                    handoff still runs — what it does not have is the provider
#                    descriptor, which it does not need because its AEP names
#                    are compiled in.
#   recurrence     — the PREVIOUS contract, and it can no longer publish: it
#                    POSTs aep-api's old flat body, which aep-api stopped
#                    accepting. The handoff still files and dispatches issues
#                    correctly — what you lose is the console Alerts feed, and
#                    you lose it QUIETLY, because publishing is best-effort by
#                    design and a rejected publish only logs.
#   hand0ff-new    — handoff works; the report/console cannot say which ATTEMPT
#                    an incident is on. Recurrences are still reopened and worked
#                    correctly, because AE decides that, not the agent.
#   anthropic-patched — no handoff stage at all.
if ! docker image inspect "${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG}" >/dev/null 2>&1; then
    echo "   ${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG} not built locally — trying registry ${RCA_IMAGE_PULL}..."
    if docker pull "$RCA_IMAGE_PULL" >/dev/null 2>&1; then
        docker tag "$RCA_IMAGE_PULL" "${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG}"
        echo "✅ pulled ${RCA_IMAGE_PULL} → retagged as ${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG}"
    elif docker image inspect "${RCA_IMAGE_REPO}:skill-loader" >/dev/null 2>&1; then
        echo "⚠️  ${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG} is neither built nor pullable —"
        echo "    falling back to ${RCA_IMAGE_REPO}:skill-loader."
        echo "    Its handoff stage needs a provider descriptor mounted at"
        echo "    /etc/rca-agent/handoff/provider.json — step 3d no longer creates"
        echo "    that mount, so the handoff stage will fail to start. RCA itself"
        echo "    (minus the handoff) still works."
        echo "    Build the current image to fix:"
        echo "      cd <openchoreo>/agents && docker build -t ${RCA_IMAGE_REPO}:fingerprint-fix -f sre-agent/Dockerfile ."
        RCA_IMAGE_TAG="skill-loader"
    elif docker image inspect "${RCA_IMAGE_REPO}:handoff-provider" >/dev/null 2>&1; then
        echo "⚠️  ${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG} is neither built nor pullable —"
        echo "    falling back to ${RCA_IMAGE_REPO}:handoff-provider."
        echo "    Same descriptor dependency as skill-loader: step 3d no longer"
        echo "    creates the /etc/rca-agent/handoff/provider.json mount this image"
        echo "    expects, so its handoff stage will fail to start. RCA itself"
        echo "    (minus the handoff) still works."
        echo "    Build the current image to fix:"
        echo "      cd <openchoreo>/agents && docker build -t ${RCA_IMAGE_REPO}:fingerprint-fix -f sre-agent/Dockerfile ."
        RCA_IMAGE_TAG="handoff-provider"
    elif docker image inspect "${RCA_IMAGE_REPO}:report-sink" >/dev/null 2>&1; then
        echo "⚠️  ${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG} is neither built nor pullable —"
        echo "    falling back to ${RCA_IMAGE_REPO}:report-sink."
        echo "    Everything works: it reads the AE_* config keys this script also"
        echo "    writes, and its AEP tool names are compiled in rather than read"
        echo "    from the provider descriptor. Build the current image to fix:"
        echo "      cd <openchoreo>/agents && docker build -t ${RCA_IMAGE_REPO}:fingerprint-fix -f sre-agent/Dockerfile ."
        RCA_IMAGE_TAG="report-sink"
    elif docker image inspect "${RCA_IMAGE_REPO}:recurrence" >/dev/null 2>&1; then
        echo "⚠️  ${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG} is neither built nor pullable —"
        echo "    falling back to ${RCA_IMAGE_REPO}:recurrence."
        echo "    The handoff WORKS — issues are still filed and dispatched. What you"
        echo "    lose is the console Alerts feed: this image POSTs aep-api's old flat"
        echo "    report body, which current aep-api rejects, and publishing is"
        echo "    best-effort so the rejection only shows up in the agent's log."
        echo "    Build the current image to fix:"
        echo "      cd <openchoreo>/agents && docker build -t ${RCA_IMAGE_REPO}:fingerprint-fix -f sre-agent/Dockerfile ."
        RCA_IMAGE_TAG="recurrence"
    elif docker image inspect "${RCA_IMAGE_REPO}:hand0ff-new" >/dev/null 2>&1; then
        echo "⚠️  ${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG} is neither built nor pullable —"
        echo "    falling back to ${RCA_IMAGE_REPO}:hand0ff-new."
        echo "    The handoff WORKS and recurrences are still reopened and worked (AE"
        echo "    decides that). You lose the console Alerts feed (as above) AND the"
        echo "    report saying WHICH ATTEMPT an incident is on, so a third attempt"
        echo "    reads as the first. Build the current image to fix:"
        echo "      cd <openchoreo>/agents && docker build -t ${RCA_IMAGE_REPO}:fingerprint-fix -f sre-agent/Dockerfile ."
        RCA_IMAGE_TAG="hand0ff-new"
    elif docker image inspect "${RCA_IMAGE_REPO}:anthropic-patched" >/dev/null 2>&1; then
        echo "⚠️  registry pull failed — falling back to ${RCA_IMAGE_REPO}:anthropic-patched"
        echo "    (RCA works, AEP handoff stage ABSENT)."
        RCA_IMAGE_TAG="anthropic-patched"
    fi
fi
RCA_IMAGE="${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG}"
# k3d image import is known to flake transiently ("short read ... unexpected
# EOF" while ingesting a layer blob — truncated docker→node tar stream), and
# some k3d versions exit 0 anyway. So: import, VERIFY the image is really in
# the node's containerd, retry once, and if it still isn't there fall back to
# registry-direct (helm values point at $RCA_IMAGE_PULL and the node pulls
# from Docker Hub itself — possible since the image is published multi-arch).
_rca_image_in_node() {
    # imported local images land as docker.io/library/<repo>:<tag> — substring
    # match on repo:tag covers both that and registry-form names
    docker exec "k3d-${CLUSTER_NAME}-server-0" \
        ctr -n k8s.io images ls -q 2>/dev/null | grep -q "${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG}"
}
if docker image inspect "$RCA_IMAGE" >/dev/null 2>&1; then
    IMPORTED=""
    for attempt in 1 2; do
        k3d image import "$RCA_IMAGE" -c "$CLUSTER_NAME" || true
        if _rca_image_in_node; then IMPORTED=yes; break; fi
        echo "⚠️  import attempt ${attempt} did not land in the node (transient k3d flake) — retrying..."
    done
    if [ -n "$IMPORTED" ]; then
        # The patched tag is built locally and exists in no registry, so an image-GC
        # eviction would be unrecoverable — pin it (see pin_node_image in utils.sh).
        # It also re-verifies on EVERY server/agent node, where _rca_image_in_node
        # above only checks server-0: exit 2 means the import landed on some nodes
        # but not all, so fall through to the registry-direct path rather than
        # deploying a pod that cannot start wherever the image is missing.
        PIN_RC=0
        pin_node_image "$RCA_IMAGE" || PIN_RC=$?
        if [ "$PIN_RC" = "2" ]; then
            IMPORTED=""
        else
            echo "✅ imported $RCA_IMAGE into k3d-$CLUSTER_NAME (verified in node containerd)"
        fi
    fi
    if [ -z "$IMPORTED" ]; then
        # Registry-direct only works for a PUBLISHED tag. Pointing the cluster at
        # an unpublished one trades a failed import for an ImagePullBackOff that
        # reads like a cluster fault instead of a missing push — so check the
        # registry first, and when the tag is not there say what is actually
        # wrong and leave the pin alone.
        if docker manifest inspect "$RCA_IMAGE_PULL" >/dev/null 2>&1; then
            echo "⚠️  k3d import did not land on every node — switching to registry-direct:"
            echo "    the cluster will pull ${RCA_IMAGE_PULL} from Docker Hub instead."
            RCA_IMAGE_REPO="${RCA_IMAGE_PULL%%:*}"
            RCA_IMAGE_TAG="${RCA_IMAGE_PULL##*:}"
        else
            echo "⚠️  k3d import did not land on every node AND ${RCA_IMAGE_PULL} is not in"
            echo "    the registry, so there is nothing for the cluster to pull. The RCA pod"
            echo "    will not start. Either retry setup (the import flake is transient), or"
            echo "    push the image:"
            echo "      docker push ${RCA_IMAGE_PULL}"
        fi
    fi
else
    echo "⚠️  $RCA_IMAGE not found locally and registry pull failed — build it"
    echo "    (docker build -t $RCA_IMAGE <openchoreo>/agents/sre-agent) or the RCA pod"
    echo "    will stay ImagePullBackOff. Continuing; other obs-plane components are unaffected."
fi
ANTHROPIC_API_KEY="$(grep -E '^ANTHROPIC_API_KEY=' "$SCRIPT_DIR/../.env" 2>/dev/null | head -1 | cut -d= -f2-)"
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "⚠️  ANTHROPIC_API_KEY not set in deployments/.env — RCA agent will fail its"
    echo "    LLM connection test. Set it (or switch rca.llm.modelName to an OpenAI model)."
fi
kubectl --context "$CLUSTER_CONTEXT" -n "$NS" create secret generic rca-agent-secret \
    --from-literal=RCA_LLM_API_KEY="$ANTHROPIC_API_KEY" \
    --from-literal=OAUTH_CLIENT_SECRET="openchoreo-rca-agent-secret" \
    --dry-run=client -o yaml | kubectl --context "$CLUSTER_CONTEXT" apply -f - >/dev/null
echo "✅ rca-agent-secret applied"

# ── 2. Observability plane chart (Observer + cluster-agent + RCA) ────────
echo ""
echo "2️⃣  openchoreo-observability-plane chart (v${OBS_PLANE_VERSION})"
cat > /tmp/obs-plane-values.yaml <<EOF
observer:
  openSearchSecretName: opensearch-admin-credentials
  secretName: observer-secret
  http:
    hostnames:
      - observer.openchoreo.localhost
  # The obs-plane runs co-located with the control-plane here, so talk
  # to it via in-cluster DNS instead of the chart default
  # (api.openchoreo.localhost, which only resolves on the host).
  controlPlaneApiUrl: "http://openchoreo-api.openchoreo-control-plane.svc.cluster.local:8080"
security:
  enabled: true
  oidc:
    jwksUrl: "http://thunder-service.thunder.svc.cluster.local:8090/oauth2/jwks"
    tokenUrl: "http://thunder-service.thunder.svc.cluster.local:8090/oauth2/token"
    authServerBaseUrl: "http://thunder.openchoreo.localhost:8080"
rca:
  # SRE / RCA agent. Uses a locally-built image that carries the Anthropic
  # structured-output fix (ToolStrategy instead of ProviderStrategy — the stock
  # ghcr.io/openchoreo/sre-agent image rejects Anthropic with many tools:
  # "grammar too large") and, with the 'handoff' tag, the AEP coding-agent
  # handoff stage. Built + imported in step 1b above. If you switch to an
  # OpenAI model without the handoff, the stock image works and you can drop
  # the image override.
  enabled: true
  image:
    repository: ${RCA_IMAGE_REPO}
    tag: ${RCA_IMAGE_TAG}
    pullPolicy: IfNotPresent          # locally-imported image, not a registry pull
  llm:
    modelName: anthropic:claude-sonnet-4-6
  secretName: rca-agent-secret        # created in step 1b (RCA_LLM_API_KEY + OAUTH_CLIENT_SECRET)
  oauth:
    clientId: openchoreo-rca-agent    # registered by the Thunder bootstrap (values-thunder.yaml)
  openchoreoApiUrl: "http://openchoreo-api.openchoreo-control-plane.svc.cluster.local:8080"
  # Stock limit is cpu:250m — too low for trace-heavy analyses. The agent can
  # trip its liveness probe (exit 137) mid-run, which orphans the report in
  # "pending". Bump CPU/mem so analyses complete.
  resources:
    requests:
      cpu: 250m
      memory: 1Gi
    limits:
      cpu: "1"
      memory: 2Gi
  http:
    hostnames:
      - rca-agent.openchoreo.localhost
# Disable the chart's standalone Gateway on :11080. k3d-openchoreo-serverlb
# doesn't expose 11080, and step 4 below adds a cross-NS HTTPRoute on the
# main kgateway (:8080) which is what the BFF reaches via
# Host: observer.openchoreo.localhost. The bundled Gateway is dead weight.
gateway:
  enabled: false
EOF
# Use `upgrade --install` (not the shared helm_install_if_not_exists helper)
# so re-runs pick up value changes from /tmp/obs-plane-values.yaml. The
# helper skips already-installed releases, which would silently bypass any
# future tuning here.
#
# --force-conflicts: this Helm (v4+) defaults --server-side to "auto", which
# uses SSA once a release's prior revision did. Step 3b below kubectl-patches
# observer-config/rca-agent-config/the ai-rca-agent deployment AFTER every
# helm run (deliberately — see that step's comment), which stamps those
# fields with fieldManager "kubectl-patch". Without --force-conflicts, the
# NEXT re-run of this same `helm upgrade` fails outright ("Apply failed with
# 1 conflict: conflict with \"kubectl-patch\"") because SSA sees a foreign
# owner on a field the chart also sets. Safe to force here: step 3b
# unconditionally re-asserts the authoritative values right after this
# command anyway, so which side wins THIS apply doesn't matter.
helm upgrade --install observability-plane \
    "oci://ghcr.io/openchoreo/helm-charts/openchoreo-observability-plane" \
    --namespace "$NS" --create-namespace --kube-context "${CLUSTER_CONTEXT}" \
    --version "$OBS_PLANE_VERSION" \
    --values /tmp/obs-plane-values.yaml \
    --force-conflicts \
    --timeout 10m
echo "⏳ Waiting for Observer + controller-manager..."
kubectl --context "$CLUSTER_CONTEXT" -n "$NS" wait --for=condition=Available deployment/observer --timeout=300s
kubectl --context "$CLUSTER_CONTEXT" -n "$NS" wait --for=condition=Available deployment/controller-manager --timeout=300s
echo "✅ observability-plane ready"

# ── 3. Logs + OpenSearch + Fluent Bit chart ──────────────────────────────
echo ""
echo "3️⃣  observability-logs-opensearch chart (v${OBS_LOGS_VERSION})"
cat > /tmp/obs-logs-values.yaml <<EOF
openSearchSetup:
  openSearchSecretName: opensearch-admin-credentials
# Local-dev sizing — default heap is -Xmx512M, which resolves to ~980 MiB
# resident with JVM overhead. 256M heap is enough for one developer's log
# volume and brings resident usage to ~500-600 MiB. Subchart key is
# openSearch (camelCase) — confirmed via
# 'helm get values observability-logs-opensearch --all'.
# (Backticks avoided here — this heredoc is unquoted to allow ${VAR}
# substitution elsewhere, so backticks would trigger command substitution.)
openSearch:
  opensearchJavaOpts: "-Xmx256M -Xms256M"
  resources:
    requests:
      cpu: 200m
      memory: 512Mi
    limits:
      memory: 768Mi
# Enable Fluent Bit immediately so log collection is active from first install
# (avoids a second helm-upgrade pass).
fluent-bit:
  enabled: true
# logs-adapter (0.5.x): the alert-rule evaluation engine. The observer forwards
# ObservabilityAlertRule CRUD here; the adapter materialises each rule as an
# OpenSearch alerting monitor and webhooks fired alerts back to the observer.
# adapter.enabled defaults true in >=0.5.1; it only needs the credentials ref.
adapter:
  openSearchSecretName: opensearch-admin-credentials
  # Patched build of upstream 0.5.1: alert-rule log matching is
  # case-insensitive (stock 0.5.1 compiles rules into a case-sensitive
  # wildcard, so a rule watching "ERROR" silently stops firing when a code
  # change rewords the log line to "error" — when a
  # coding-agent PR detached the alert from the failure it watched).
  # Stopgap pending the upstream PR to openchoreo/community-modules
  # (fix/alert-rule-case-insensitive-match) — drop this pin when the fix
  # ships in a released adapter (>0.5.1).
  image:
    repository: docker.io/tharindulak/observability-logs-opensearch-adapter
    tag: 0.5.1-case-insensitive
EOF
helm upgrade --install observability-logs-opensearch \
    "oci://ghcr.io/openchoreo/helm-charts/observability-logs-opensearch" \
    --namespace "$NS" --create-namespace --kube-context "${CLUSTER_CONTEXT}" \
    --version "$OBS_LOGS_VERSION" \
    --values /tmp/obs-logs-values.yaml \
    --timeout 15m
echo "⏳ Waiting for OpenSearch StatefulSet (large image — first install ~5-10 min)..."
kubectl --context "$CLUSTER_CONTEXT" -n "$NS" rollout status statefulset/opensearch-master --timeout=900s
echo "⏳ Waiting for logs-adapter..."
kubectl --context "$CLUSTER_CONTEXT" -n "$NS" rollout status deploy/logs-adapter-opensearch --timeout=300s
echo "✅ logs-opensearch ready (incl. logs-adapter)"

# ── 3b. Alert→RCA auto-trigger + AEP handoff wiring ──────────────────────
# Post-helm ConfigMap patches + restarts. Patched here (not via chart values)
# because the chart doesn't expose all these keys and observer.extraEnvs
# REPLACES chart defaults — a patch after every helm run is deterministic.
#
#   observer-config:
#     LOGS_ADAPTER_ENABLED     without it, log alert rules are never evaluated
#     RCA_SERVICE_URL          where the observer POSTs /analyze on alert fire
#     ALERT_SUPPRESSION_WINDOW per-rule+component de-dup. UNSET ⇒ NO de-dup:
#                              concurrent RCA runs race the handoff's
#                              search-then-create dedup ⇒ duplicate GitHub
#                              issues + duplicate coding-agent dispatches.
#   rca-agent-config:
#     HANDOFF_ENABLED          enables the RCA→platform handoff stage (file the issue)
#     HANDOFF_HEADER_MAP       this agent's field names -> the platform's header
#                              names (JSON object); no descriptor file to mount
#     (Whether the filed issue is handed to the coding agent, vs. left as a
#      ledger entry for a human to adopt, is AEP_HANDOFF_ADOPT on the
#      aep-mcp-server deployment — see docker-compose.yml / helm values
#      aepMcpServer.handoffAdopt. Nothing on the SRE agent side controls it.)
#     HANDOFF_API_URL          aep-mcp-server base URL (host.k3d.internal:3401)
#     REPORT_SINK              publish completed reports downstream (webhook)
#     REPORT_SINK_URL          full report endpoint on aep-api (:9090/api/v1/...)
echo ""
echo "3️⃣b Alert→RCA auto-trigger + AEP handoff wiring"
kubectl --context "$CLUSTER_CONTEXT" -n "$NS" patch cm observer-config --type=merge -p \
    '{"data":{"LOGS_ADAPTER_ENABLED":"true","RCA_SERVICE_URL":"http://ai-rca-agent:8080","ALERT_SUPPRESSION_WINDOW":"1h"}}'
kubectl --context "$CLUSTER_CONTEXT" -n "$NS" rollout restart deploy/observer
# Both key sets are written on purpose. The agent renamed AE_* to HANDOFF_* when
# the handoff stopped carrying AEP's vocabulary, and the fallback tags below
# predate that. An image reads the set it knows and ignores the other
# (pydantic Settings allows extras), so one ConfigMap serves any tag on the
# ladder — without this, falling back to report-sink would leave HANDOFF_* set,
# AE_HANDOFF unset, and the handoff SILENTLY off. Drop the AE_* three once no
# deployment can roll back past handoff-provider.
# AE_AUTO_DISPATCH is hardcoded true: it is only read by a pinned report-sink
# tier image (see the degradation ladder above) and, like the HANDOFF_HAND_OVER
# key this ConfigMap no longer sets, has no effect on the handoff-provider
# image this script deploys by default — adoption there is AEP_HANDOFF_ADOPT
# on aep-mcp-server, not anything in this ConfigMap.
if [ "$HANDOFF_ENABLED" = "true" ]; then
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" patch cm rca-agent-config --type=merge -p \
        "{\"data\":{\"HANDOFF_ENABLED\":\"true\",\"HANDOFF_API_URL\":\"${HANDOFF_API_URL}\",\"HANDOFF_HEADER_MAP\":$(printf '%s' "$HANDOFF_HEADER_MAP" | jq -Rs .),\"REPORT_SINK\":\"${REPORT_SINK}\",\"REPORT_SINK_URL\":\"${REPORT_SINK_URL}\",\"AE_HANDOFF\":\"true\",\"AE_AUTO_DISPATCH\":\"true\",\"AE_API_URL\":\"${HANDOFF_API_URL}\"}}"
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" rollout restart deploy/ai-rca-agent
    echo "   Handoff: enabled (mcp=${HANDOFF_API_URL})"
    echo "   Header map: ${HANDOFF_HEADER_MAP}"
    echo "   Report sink: ${REPORT_SINK:-<none>} → ${REPORT_SINK_URL}"
else
    echo "   Handoff: disabled (HANDOFF_ENABLED=false)"
fi
kubectl --context "$CLUSTER_CONTEXT" -n "$NS" rollout status deploy/observer --timeout=300s
if [ "$HANDOFF_ENABLED" = "true" ]; then
    # With HANDOFF_ENABLED=true the agent's boot-time MCP test is FATAL: it must
    # reach aep-mcp-server (docker-compose, started later by start.sh). Only
    # wait for readiness if that server is already up (i.e. setup is being
    # re-run on a live stack); on a fresh setup the crash-loop is expected
    # and start.sh auto-recovers the agent once compose is up.
    if curl -s --max-time 2 http://localhost:3401/healthz 2>/dev/null | grep -q '"ok"'; then
        kubectl --context "$CLUSTER_CONTEXT" -n "$NS" rollout status deploy/ai-rca-agent --timeout=300s || \
            echo "⚠️  ai-rca-agent not ready — check the RCA image import in step 1b"
    else
        echo "ℹ️  aep-mcp-server not running yet — ai-rca-agent will crash-loop until"
        echo "    'bash scripts/start.sh' brings the compose stack up (start.sh then"
        echo "    auto-restarts the agent). This is expected on a fresh setup."
    fi
fi
echo "✅ auto-trigger + handoff wiring applied"

# ── 3c. Dynamic Anthropic key — reuse the org's key as set via the AE console ──
# AnthropicCredentialService.Connect() (aep-api) stores the console-connected
# key in Postgres (org_secrets, AES-256-GCM) and best-effort mirrors it into
# OpenBao via the SM-API stub. aep-api pushes nothing into this namespace: the
# observability workstream owns the RCA agent's own ExternalSecret, declared
# against the org's Anthropic KV path with a refreshInterval that re-syncs it
# after a connect or a rotation.
#
# This script owns BOTH halves: the ExternalSecret that pulls the key, and the
# volume + mount + env var wiring it feeds. Leaving the ExternalSecret to "the
# RCA agent's own manifest" left nothing creating it on either install path, so
# a fresh plane came up with the mount permanently empty; the only remedy was a
# hand-created Secret, which every reinstall then deleted. If no key has been
# connected yet, `optional: true` on the volume's secret source means the mount
# is just an empty dir rather than blocking the pod in ContainerCreating —
# resolve_api_key() falls back to the static RCA_LLM_API_KEY, and main.py's
# boot-time LLM test skips (warns, doesn't crash) when neither source has a key.
#
# The ExternalSecret matches on a PATH PATTERN rather than a fixed remoteRef.key.
# The per-org vault path is
#   user-app-secrets/wc-<8 of org uuid>-<8 of sha256(org uuid)>/anthropic-secrets
# and that org UUID does not exist at install time — organizations.thunder_org_uuid
# is populated from the JWT's ouId claim, i.e. only once a user has authenticated
# (see services/aep-api/internal/migrate/phase3_thunder_org_uuid.go). A fixed key
# could therefore never be written by this script; `find` sidesteps the org UUID
# entirely and starts resolving the moment a key is connected.
#
# SINGLE-ORG by construction: two connected orgs would both match, and the range
# in the template would concatenate their keys into one invalid value. Revisit if
# the observability plane ever serves more than one org.
echo ""
echo "3️⃣c Dynamic Anthropic key (ExternalSecret + volume wiring)"
kubectl --context "$CLUSTER_CONTEXT" apply -f - <<EOF
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: rca-agent-anthropic-secret
  namespace: $NS
spec:
  # 15s matches the per-org secrets ESO already syncs for the coding agent.
  # observer-secret's 1h would leave RCA broken for up to an hour after a connect.
  refreshInterval: 15s
  secretStoreRef:
    kind: ClusterSecretStore
    name: default
  target:
    name: rca-agent-anthropic-secret
    template:
      engineVersion: v2
      data:
        # hasKey rather than a bare index: Go templates render a missing key as
        # the literal string "<no value>", which would mount a syntactically
        # valid but garbage API key that only fails at analysis time.
        RCA_LLM_API_KEY: '{{ range \$k, \$v := . }}{{ \$d := \$v | fromJson }}{{ if hasKey \$d "api-key" }}{{ index \$d "api-key" }}{{ end }}{{ end }}'
  dataFrom:
    - find:
        path: user-app-secrets/
        name:
          # Anchored: SecretRefName() also mints task-scoped names of the form
          # <task>-<entity>-secrets, and an unanchored "anthropic-secrets" would
          # match those too, concatenating a second key into the value. The
          # coding role's "anthropic-coding-secrets" does not match either way.
          regexp: "(^|/)anthropic-secrets\$"
EOF
echo "✅ rca-agent-anthropic-secret ExternalSecret applied"
# Patched onto the Deployment (not chart values) for the same "survives a
# helm re-run" reason as step 3b's ConfigMap patches. A podSpec change here
# triggers K8s's normal rolling update on its own — no explicit restart needed.
kubectl --context "$CLUSTER_CONTEXT" -n "$NS" patch deployment ai-rca-agent --type=strategic -p '
spec:
  template:
    spec:
      volumes:
        - name: anthropic-key
          secret:
            secretName: rca-agent-anthropic-secret
            optional: true
            defaultMode: 0400
      containers:
        - name: ai-rca-agent
          volumeMounts:
            - name: anthropic-key
              mountPath: /etc/rca-agent/anthropic
              readOnly: true
          env:
            - name: RCA_LLM_API_KEY_FILE
              value: /etc/rca-agent/anthropic/RCA_LLM_API_KEY
'
echo "✅ ai-rca-agent volume/env wired for the dynamic Anthropic key"
echo "   The RCA agent's own ExternalSecret (against the org's Anthropic KV path) fills this mount."
echo "   Until one exists it falls back to the static RCA_LLM_API_KEY from step 1b."

# ── 3d. AEP-owned handoff skill (coding-agent-handoff) — deploy-time mount ───────────
# The handoff sub-agent loads the 'coding-agent-handoff' skill (search related issues,
# file the one issue that hands a code-level root cause to the coding agent).
# It neither classifies config-vs-code nor dedupes — the agent derives the
# classification before the stage runs and AEP derives the dedupe key
# server-side. Its content IS AEP's contract (aep:* / sre-agent labels,
# taskmeta block, dedupe keys, unprefixed component names), so AEP owns it —
# canonical source: services/aep-mcp-server/skills/coding-agent-handoff/SKILL.md, right
# here in this repo. The SRE agent does NOT bake it into its image and does NOT fetch
# it at runtime; we materialize it into a ConfigMap and mount it, and the
# agent's EXTERNAL_SKILLS_DIR points its loader at the mount (searched before
# the built-in src/skills library). Same "patch the Deployment so it survives
# a helm re-run" pattern as step 3c's volume wiring.
#
# Only wired when HANDOFF_ENABLED=true — without the handoff stage the agent never
# loads a skill, so there's nothing to mount.
if [ "$HANDOFF_ENABLED" = "true" ]; then
    echo ""
    echo "3️⃣d Handoff skills — one ConfigMap + mount per skill"
    HANDOFF_SKILLS_ROOT="$SCRIPT_DIR/../../services/aep-mcp-server/skills"
    # Every directory holding a SKILL.md is mounted, so a second skill needs no
    # edit here. EXTERNAL_SKILLS_DIR already points at the PARENT directory, so
    # the agent's loader finds whatever appears beside the first one — which is
    # what OpenChoreo's shared skills directory will land as.
    HANDOFF_SKILL_NAMES=()
    for skill_dir in "$HANDOFF_SKILLS_ROOT"/*/; do
        [ -f "${skill_dir}SKILL.md" ] || continue
        HANDOFF_SKILL_NAMES+=("$(basename "$skill_dir")")
    done
    if [ ${#HANDOFF_SKILL_NAMES[@]} -eq 0 ]; then
        echo "❌ no skill found under $HANDOFF_SKILLS_ROOT (expected <name>/SKILL.md)"
        echo "   HANDOFF_ENABLED is on, and the stage's whole playbook IS the mounted"
        echo "   skill. The agent's config validator refuses to start without"
        echo "   EXTERNAL_SKILLS_DIR, and an empty mount fails load_skills once per"
        echo "   incident — the report then records only that the stage failed."
        exit 1
    fi

    SKILL_VOLUMES=""
    SKILL_MOUNTS=""
    for skill_name in "${HANDOFF_SKILL_NAMES[@]}"; do
        skill_dir="$HANDOFF_SKILLS_ROOT/$skill_name"
        # Render deterministically (create --dry-run) then apply, so re-runs are
        # idempotent and the ConfigMap can be diffed. One key per MARKDOWN file,
        # named by basename, so a skill that grows sibling reference files (the
        # usual cure for a long skill: push reference behind a pointer) reaches
        # the pod whole.
        #
        # *.md rather than the whole directory on purpose: a skill folder may also
        # hold assets meant for humans (a diagram, say), and --from-file on a
        # directory would base64 them into the ConfigMap — a 300K image is a third
        # of the 1MiB object limit spent shipping something the agent cannot see.
        # ConfigMaps can't have '/' in keys either, so the folder stays flat — a
        # subdirectory is silently skipped, leaving a pointer resolving to nothing.
        SKILL_KEYS=()
        for skill_file in "$skill_dir"/*.md; do
            [ -f "$skill_file" ] || continue
            SKILL_KEYS+=(--from-file="$(basename "$skill_file")=$skill_file")
        done
        kubectl --context "$CLUSTER_CONTEXT" -n "$NS" create configmap "rca-agent-skill-$skill_name" \
            "${SKILL_KEYS[@]}" \
            --dry-run=client -o yaml | kubectl --context "$CLUSTER_CONTEXT" apply -f - >/dev/null
        echo "✅ rca-agent-skill-$skill_name ConfigMap applied (${#SKILL_KEYS[@]} md file(s) from $skill_dir)"

        # The volume name keeps the <skill>-skill shape an earlier run of this
        # script already wrote. A strategic-merge patch merges volumes BY NAME,
        # so renaming would leave the old volume in place beside the new one and
        # mount two of them on the same path.
        SKILL_VOLUMES="$SKILL_VOLUMES
        - name: $skill_name-skill
          configMap:
            name: rca-agent-skill-$skill_name
            items: null"
        SKILL_MOUNTS="$SKILL_MOUNTS
            - name: $skill_name-skill
              mountPath: /etc/rca-agent/skills/$skill_name
              readOnly: true"
    done

    # Patch the Deployment: mount every skill under /etc/rca-agent/skills and
    # point the loader at that parent. A podSpec change here triggers a rolling
    # update on its own.
    #
    # `items: null` projects EVERY key as a file named by its key, so a mount
    # mirrors its skill folder and a new sibling file needs no patch change. The
    # explicit null is load-bearing: an earlier run of this script wrote
    # items[SKILL.md], and a strategic-merge patch that merely omits the field
    # would leave that list in place — the new files would be absent from the pod
    # with nothing in the diff to show it, which is the silent half-mount this
    # whole step guards against.
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" patch deployment ai-rca-agent --type=strategic -p "
spec:
  template:
    spec:
      volumes:$SKILL_VOLUMES
      containers:
        - name: ai-rca-agent
          volumeMounts:$SKILL_MOUNTS
          env:
            - name: EXTERNAL_SKILLS_DIR
              value: /etc/rca-agent/skills
"
    echo "✅ ai-rca-agent volumes/env wired for ${#HANDOFF_SKILL_NAMES[@]} skill(s) (EXTERNAL_SKILLS_DIR=/etc/rca-agent/skills)"
    echo "   Edit a skill under services/aep-mcp-server/skills/, or add a sibling directory"
    echo "   holding its own SKILL.md, then re-run this script and restart the agent —"
    echo "   no SRE image rebuild, and no edit to this script for a new skill."
fi

# ── 4. Cross-namespace HTTPRoute on the MAIN kgateway ────────────────────
# The chart's own HTTPRoute attaches to a separate Gateway on port 11080.
# k3d's serverlb only exposes the main kgateway on port 8080. Add a second
# HTTPRoute targeting the main kgateway so docker-compose-hosted BFF can
# reach the Observer via http://k3d-openchoreo-serverlb:8080 + Host header.
echo ""
echo "4️⃣  Cross-namespace HTTPRoute on main kgateway"
kubectl --context "$CLUSTER_CONTEXT" apply -f - <<EOF
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: observer-mainkgw
  namespace: $NS
spec:
  parentRefs:
    - name: gateway-default
      namespace: openchoreo-control-plane
      sectionName: http
  hostnames:
    - observer.openchoreo.localhost
  rules:
    - matches:
        - path: { type: PathPrefix, value: / }
      backendRefs:
        - name: observer
          port: 8080
      timeouts:
        request: "0s"
        backendRequest: "0s"
EOF
echo "✅ HTTPRoute observer-mainkgw applied"

# ── 4b. AEP authz role + binding for Observer ───────────────────
# The OC control-plane chart ships a `observer-resource-reader` role
# bound to `openchoreo-observer-resource-reader-client` (the Observer's
# UID-resolver subject), but that role only has component/project/
# namespace/environment :view — NOT logs:view or workflowrun:view, both
# of which the Observer requires for /api/v1/logs/query. Without these
# the Observer returns 403 "no matching policies found" even though
# JWT auth succeeds. Mirrors v2 wso2cloud-deployment/.../init/layer-2/controlplane.yaml.
echo ""
echo "4b. AEP ClusterAuthzRole + binding for Observer"
kubectl --context "$CLUSTER_CONTEXT" apply -f - <<'EOF'
apiVersion: openchoreo.dev/v1alpha1
kind: ClusterAuthzRole
metadata:
  name: aep-observer-reader
spec:
  actions:
    - "logs:view"
    - "workflowrun:view"
    - "component:view"
    - "project:view"
    - "namespace:view"
    - "environment:view"
---
apiVersion: openchoreo.dev/v1alpha1
kind: ClusterAuthzRoleBinding
metadata:
  name: aep-observer-reader-binding
spec:
  effect: allow
  entitlement:
    claim: sub
    value: openchoreo-observer-resource-reader-client
  roleMappings:
    - roleRef:
        kind: ClusterAuthzRole
        name: aep-observer-reader
EOF
echo "✅ AEP observer-reader role + binding applied"

# ── 5. ClusterObservabilityPlane CR (registers plane with the CP) ────────
echo ""
echo "5️⃣  ClusterObservabilityPlane CR"
# The cluster-agent needs the CA of the local obs-plane to verify the
# Observer's TLS cert. The chart creates a cluster-agent TLS secret (cluster-agent-tls) with the CA, but does not expose it as a value. Grab it from the secret and inject it into the CR.
# Checked in two steps (not a single piped command) because `set -e` alone
# doesn't catch a failing left side of a pipe — a missing secret or empty
# ca.crt would otherwise silently apply a ClusterObservabilityPlane with a
# blank clientCA, breaking cluster-agent's TLS verification with no error.
local_obs_ca_b64=$(kubectl --context "$CLUSTER_CONTEXT" get secret cluster-agent-tls -n "$NS" -o jsonpath='{.data.ca\.crt}')
if [ -z "$local_obs_ca_b64" ]; then
  echo "❌ cluster-agent-tls secret has no ca.crt data (or doesn't exist) in namespace $NS" >&2
  exit 1
fi
local_obs_ca=$(printf '%s' "$local_obs_ca_b64" | base64 -d)
if [ -z "$local_obs_ca" ]; then
  echo "❌ failed to base64-decode ca.crt from the cluster-agent-tls secret" >&2
  exit 1
fi
kubectl --context "$CLUSTER_CONTEXT" apply -f - <<EOF
apiVersion: openchoreo.dev/v1alpha1
kind: ClusterObservabilityPlane
metadata:
  name: default
spec:
  planeID: default
  clusterAgent:
    clientCA:
      value: |
$(printf '%s' "$local_obs_ca" | sed 's/^/        /')
  observerURL: http://observer.openchoreo.localhost:11080
  # Lets the portal fetch RCA reports from the SRE agent (rca.enabled above).
  rcaAgentURL: http://rca-agent.openchoreo.localhost:11080
EOF
echo "✅ ClusterObservabilityPlane registered"

# ── 6. OpenSearch index-template bootstrap Job ───────────────────────────
# Fixes the upstream chart's race where Fluent Bit's first stdout-write can
# land before the container-logs index template applies, leaving
# kubernetes.pod_name as `text` instead of `keyword` — Observer's wildcard
# query then matches zero docs. Self-healing: applies the priority-500
# composable template and deletes any indices with the wrong mapping.
echo ""
echo "6️⃣  OpenSearch index-template bootstrap Job"
kubectl --context "$CLUSTER_CONTEXT" -n "$NS" delete job opensearch-bootstrap-templates --ignore-not-found >/dev/null
kubectl --context "$CLUSTER_CONTEXT" apply -f - <<'EOF'
apiVersion: batch/v1
kind: Job
metadata:
  name: opensearch-bootstrap-templates
  namespace: openchoreo-observability-plane
spec:
  backoffLimit: 5
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: bootstrap
          image: curlimages/curl:8.10.1
          env:
            - { name: OS_HOST, value: opensearch }
            - { name: OS_PORT, value: "9200" }
            - name: OS_USER
              valueFrom: { secretKeyRef: { name: opensearch-admin-credentials, key: username } }
            - name: OS_PASS
              valueFrom: { secretKeyRef: { name: opensearch-admin-credentials, key: password } }
          command: ["/bin/sh", "-c"]
          args:
            - |
              set -eu
              OS="https://${OS_HOST}:${OS_PORT}"
              CURL="curl -sk -u ${OS_USER}:${OS_PASS} -H Content-Type:application/json"
              echo "Waiting for OpenSearch ready..."
              for i in $(seq 1 60); do
                if $CURL "${OS}/_cluster/health?wait_for_status=yellow&timeout=5s" >/dev/null 2>&1; then break; fi
                sleep 5
              done
              # Do NOT PUT a template here. The 0.5.x module chart's own setup job
              # (post-install/upgrade hook) applies the authoritative container-logs
              # template: log as `wildcard` (the alert monitors' *phrase* queries
              # need it — on `text`, wildcard patterns match analysed lowercase
              # tokens and "ERROR" silently matches nothing), pod_name/labels as
              # keyword (the monitors' UID `term` filters need keyword). A custom
              # same-name template REPLACES the chart's and broke both — this job
              # is now detection + self-heal only.
              echo "Verifying chart template is in place (log must be wildcard-typed)..."
              tpl_log=$($CURL "${OS}/_index_template/container-logs" 2>/dev/null \
                | grep -o '"log":{"type":"[a-z_]*"}' | head -1 | cut -d'"' -f6)
              if [ "$tpl_log" != "wildcard" ]; then
                echo "WARNING: container-logs template maps log as '${tpl_log:-absent}' (expected 'wildcard')."
                echo "         The module chart's opensearch-setup-logs hook job should own this template."
              fi
              echo "Scanning indices for wrong mappings (pod_name/labels != keyword, log != wildcard)..."
              for idx in $($CURL "${OS}/_cat/indices/container-logs-*?h=index" 2>/dev/null); do
                t=$($CURL "${OS}/${idx}/_mapping/field/kubernetes.pod_name" 2>/dev/null \
                  | grep -o '"type":"[a-z]*"' | head -1 | cut -d'"' -f4)
                lt=$($CURL "${OS}/${idx}/_mapping/field/kubernetes.labels.openchoreo_dev%2Fcomponent-uid" 2>/dev/null \
                  | grep -o '"type":"[a-z]*"' | head -1 | cut -d'"' -f4)
                lg=$($CURL "${OS}/${idx}/_mapping/field/log" 2>/dev/null \
                  | grep -o '"type":"[a-z_]*"' | head -1 | cut -d'"' -f4)
                if [ "$t" = "text" ] || [ "$lt" = "text" ] || { [ -n "$lg" ] && [ "$lg" != "wildcard" ]; }; then
                  echo "  - ${idx}: pod_name='$t' component-uid='$lt' log='$lg', recreating"
                  $CURL -X DELETE "${OS}/${idx}" >/dev/null
                else echo "  - ${idx}: pod_name='$t' component-uid='${lt:-unset}' log='${lg:-unset}', ok"; fi
              done
              echo "Bootstrap complete."
EOF
echo "⏳ Waiting for bootstrap Job to finish..."
kubectl --context "$CLUSTER_CONTEXT" -n "$NS" wait --for=condition=complete job/opensearch-bootstrap-templates --timeout=300s
echo "✅ OpenSearch index-template bootstrap complete"

echo ""
echo "✅ Observability Plane installation complete!"
echo ""
echo "   Alert→RCA→coding-agent handoff is wired (HANDOFF_ENABLED=${HANDOFF_ENABLED})."
echo "   One step can't be automated: create an ObservabilityAlertRule per"
echo "   component you want auto-RCA on (needs the component's UID + name"
echo "   labels, incident.enabled + triggerAiRca: true)."
echo "   Guide: docs/developer-guide/sre-handoff-runbook.md"
