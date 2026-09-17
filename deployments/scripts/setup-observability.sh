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
# setup.sh runs this stage unconditionally — Agent Manager's charts install
# against the plane — and then PARKS its heavy workloads (OpenSearch, Fluent
# Bit, the RCA agent, the adapters) at zero replicas, because this is the
# heaviest install and most local work never reads it. Live Progress's log
# archive and the alert→RCA handoff need it running:
# `bash scripts/park-observability.sh up`. start.sh recognises the parked state
# (see its stage 7c).
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
#       and rca-agent-config's HANDOFF_ENABLED / REPORT_SINK / REPORT_SINK_URL.
#       Patched after helm so chart upgrades can't silently drop them on
#       re-runs.
#   - ConfigMap sre-agent-extensions + volume mount (post-helm): renders
#       mcp.json/CONTEXT.md/the coding-agent-handoff skill into one ConfigMap
#       and mounts it at EXTENSIONS_DIR/remediation/ on the RCA deployment —
#       the generic extensions mechanism (openchoreo#4743), replacing the old
#       HANDOFF_* ConfigMap keys and the per-skill ConfigMap loop.
#   - Route + DNS + cert trust for aep-mcp.openchoreo.localhost (step 3f):
#       a CoreDNS priority override (0-aep-mcp.override) so this one hostname
#       resolves to the control-plane gateway instead of the data-plane one
#       every other *.openchoreo.localhost name uses; a headless Service +
#       hand-written EndpointSlice routing to host.k3d.internal (kgateway
#       doesn't resolve ExternalName Services); and a combined CA bundle
#       (the RCA image's own certifi store + the control-plane gateway's CA)
#       mounted with SSL_CERT_FILE, so the remediation agent trusts the
#       gateway's self-signed cert without losing trust in api.anthropic.com.
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
#   RCA_IMAGE_REPO  RCA/SRE agent image repository (default:
#                   tharindulak/sre-agent — see RCA_IMAGE_TAG below for why
#                   this isn't yet the vanilla ghcr.io/openchoreo/ai-rca-agent
#                   repo the observability-plane chart's own values.yaml
#                   defaults to). No longer the OLD tharindulak/sre-agent
#                   fork — that one existed to carry the bespoke HANDOFF_*
#                   config this script now retires; this is a different,
#                   narrower rebuild of the vanilla image (see below).
#   RCA_IMAGE_TAG   RCA/SRE agent image tag (default:
#                   v1.0.1-hotfix.1-anthropic). TEMPORARY: the vanilla
#                   ghcr.io/openchoreo/ai-rca-agent:v1.0.1-hotfix.1 image's
#                   pyproject.toml/uv.lock never declare langchain-anthropic,
#                   so init_chat_model("anthropic:...") fails at runtime —
#                   and AEP's own RCA config (RCA_LLM_API_KEY sourced from
#                   aep/anthropic-api-key, model default
#                   anthropic:claude-sonnet-4-6) is Anthropic-only. This tag
#                   is the same v1.0.1-hotfix.1 base rebuilt with only
#                   langchain-anthropic added to pyproject.toml/uv.lock and
#                   the ToolStrategy-for-Anthropic branch in agent.py (the
#                   change already merged upstream as commit 43efc190 on a
#                   since-superseded branch, re-applied rather than
#                   cherry-picked because that commit's uv.lock has drifted
#                   from current upstream). Per OpenChoreo PR #4743 (merged
#                   well before the v1.0.1-hotfix.1 release this rebuilds),
#                   it still carries the generic EXTENSIONS_DIR mechanism
#                   that step 3e below mounts mcp.json/CONTEXT.md/the
#                   coding-agent-handoff skill into — changing the handoff's
#                   behaviour needs no image rebuild. Revert both defaults to
#                   ghcr.io/openchoreo/ai-rca-agent:v1.0.1-hotfix.1 once
#                   upstream OpenChoreo carries Anthropic support (or once
#                   AEP switches its own RCA model config to a provider the
#                   vanilla image already supports, e.g. OpenAI).
#   HANDOFF_ENABLED enable the RCA→platform coding-agent handoff (default:
#                   true). The vanilla agent reaches aep-mcp-server through
#                   its EXTENSIONS_DIR/remediation/mcp.json mount
#                   (AEP_MCP_HOSTNAME + AEP_MCP_TOKEN below), not a bespoke
#                   header map. The handoff files ONE issue for code-level
#                   work; AEP adopts it on creation, which is what puts the
#                   coding agent on it. Whether the filed issue is handed to
#                   the coding agent (vs. left as a ledger entry for a human
#                   to adopt) is controlled by AEP_HANDOFF_ADOPT on the
#                   aep-mcp-server deployment, not by anything on the SRE
#                   agent side.
#   AEP_MCP_HOSTNAME hostname the mounted mcp.json points the remediation
#                   agent at (default: aep-mcp.openchoreo.localhost). Must
#                   resolve, over HTTPS, from inside the k3d cluster — see
#                   docs/design/draft/2026-09-17-sre-agent-extensions-handoff.md
#                   decision 6. (Local dev has no cross-namespace HTTPRoute
#                   for aep-mcp-server yet, the same open item Task 4 flagged
#                   for the Helm path — this default won't actually resolve
#                   until that follow-up lands.)
#   AEP_MCP_TOKEN   the long-lived service credential the mounted mcp.json
#                   authenticates with (Bearer). No default — must be set in
#                   deployments/.env (see .env.example). Same credential
#                   the aectl/Helm path's aep-mcp-token ExternalSecret carries.
#   REPORT_SINK     where completed RCA reports are published (default:
#                   webhook; empty = nowhere, which silently empties the
#                   console Alerts bell/list).
#   REPORT_SINK_URL FULL URL of the report endpoint, not a base — the sink
#                   posts exactly here
#                   (default: http://host.k3d.internal:9090/api/v1/rca-agent/reports).
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
source "$SCRIPT_DIR/env.sh"
source "$SCRIPT_DIR/utils.sh"

# The observability plane tracks the OpenChoreo version (env.sh) — the two are
# released together and the observer speaks the control plane's API.
OBS_PLANE_VERSION="${OPENCHOREO_VERSION}"
# >= 0.5.1 REQUIRED for the logs-adapter (alert-rule evaluation engine).
# 0.3.x ships no adapter: ObservabilityAlertRules sync as Ready but are
# never evaluated — no alert ever fires, silently.
# Bumped 0.5.1 -> 0.5.3 (OBSERVABILITY_LOGS_VERSION in env.sh) for OC 1.2.0.
OBS_LOGS_VERSION="${OBSERVABILITY_LOGS_VERSION}"
# Adapter image override. Set to "" to run the chart's stock adapter image.
# See the adapter block in step 3 for why AEP carries a fork.
OBS_LOGS_ADAPTER_IMAGE_REPO="${OBS_LOGS_ADAPTER_IMAGE_REPO:-docker.io/tharindulak/observability-logs-opensearch-adapter}"
OBS_LOGS_ADAPTER_IMAGE_TAG="${OBS_LOGS_ADAPTER_IMAGE_TAG:-0.5.1-case-insensitive}"
NS="openchoreo-observability-plane"
# The SRE/RCA agent's Deployment, Service and container were all renamed
# ai-rca-agent -> sre-agent in observability-plane 1.2.0. Named once here so the
# next rename is a one-line change rather than a scavenger hunt through the
# eight places that address it.
RCA_DEPLOYMENT="sre-agent"

# SRE-agent handoff knobs (see header).
HANDOFF_ENABLED="${HANDOFF_ENABLED:-true}"
# The vanilla (unforked) SRE agent reaches aep-mcp-server through its generic
# EXTENSIONS_DIR mechanism (mcp.json + CONTEXT.md + skills/), not a bespoke
# header map — see docs/design/draft/2026-09-17-sre-agent-extensions-handoff.md.
# AEP_MCP_HOSTNAME must resolve from inside the k3d cluster; AEP_MCP_TOKEN is
# the same long-lived credential the aectl/Helm path's aep-mcp-token
# ExternalSecret carries — for local dev it comes from deployments/.env instead.
AEP_MCP_HOSTNAME="${AEP_MCP_HOSTNAME:-aep-mcp.openchoreo.localhost:8443}"
# Only required when the handoff stage is actually on — HANDOFF_ENABLED=false
# should not force every dev to have a token set (mirrors aectl sre.go, which
# reads this only inside its own `if sreAEHandoff` branch).
if [ "$HANDOFF_ENABLED" = "true" ]; then
    AEP_MCP_TOKEN="${AEP_MCP_TOKEN:-$(grep -E '^AEP_MCP_TOKEN=' "$SCRIPT_DIR/../.env" 2>/dev/null | head -1 | cut -d= -f2-)}"
    AEP_MCP_TOKEN="${AEP_MCP_TOKEN:?set AEP_MCP_TOKEN in deployments/.env — see .env.example}"
fi
# Report publishing: the agent POSTs each completed report to a configured sink
# and aep-api maps it onto its own row. REPORT_SINK_URL is the FULL endpoint —
# the sink posts exactly there, it does not append a path.
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
# The RCA agent runs the vanilla, unforked OpenChoreo image (RCA_IMAGE_REPO/
# RCA_IMAGE_TAG — see the header). It's imported into the k3d cluster the same
# way a locally-built image would be (a cluster rebuild loses imported images
# — this makes the import part of setup); if no local copy exists, it's
# pulled straight from the registry (RCA_IMAGE_PULL below) — the image is
# published multi-arch, so this always succeeds without a local build.
# The agent reads its LLM key + OAuth client secret from the rca-agent-secret
# Secret (envFrom). RCA_LLM_API_KEY comes from ANTHROPIC_API_KEY in deployments/.env;
# OAUTH_CLIENT_SECRET must equal the openchoreo-rca-agent client secret registered
# by the IdP bootstrap (single-cluster/thunder-resources/86-openchoreo-rca-agent.yaml).
echo ""
echo "1️⃣b RCA agent image + secret"
# RCA_IMAGE_REPO/RCA_IMAGE_PULL are the FULLY QUALIFIED name
# (ghcr.io/openchoreo/ai-rca-agent), not a short local alias — deliberately.
# An earlier version of this script used a short repo name here and retagged
# the pulled image to it before `k3d image import`; the Deployment then
# referenced that short, unqualified name. That worked right after import,
# but k3d/containerd's image GC can evict it later — and because the
# reference had no registry/namespace, kubelet's re-pull attempt resolved to
# docker.io/library/<name> (Docker Hub's default namespace for official
# images) instead of our actual image, and failed outright (ImagePullBackOff:
# "pull access denied, repository does not exist"). Using the fully-qualified
# name everywhere means a cache-evicted image can always be re-pulled from
# the real registry — no more silent long-term fragility.
RCA_IMAGE_REPO="${RCA_IMAGE_REPO:-tharindulak/sre-agent}"
RCA_IMAGE_TAG="${RCA_IMAGE_TAG:-v1.0.1-hotfix.1-anthropic}"
RCA_IMAGE_PULL="${RCA_IMAGE_PULL:-${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG}}"
if ! docker image inspect "${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG}" >/dev/null 2>&1; then
    echo "   ${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG} not present locally — trying registry ${RCA_IMAGE_PULL}..."
    if docker pull "$RCA_IMAGE_PULL" >/dev/null 2>&1; then
        docker tag "$RCA_IMAGE_PULL" "${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG}"
        echo "✅ pulled ${RCA_IMAGE_PULL} → retagged as ${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG}"
    else
        echo "⚠️  registry pull of ${RCA_IMAGE_PULL} failed. The RCA pod will stay"
        echo "    ImagePullBackOff until it's reachable. Continuing; other obs-plane"
        echo "    components are unaffected."
    fi
fi
RCA_IMAGE="${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG}"
# k3d image import is known to flake transiently ("short read ... unexpected
# EOF" while ingesting a layer blob — truncated docker→node tar stream), and
# some k3d versions exit 0 anyway. So: import, VERIFY the image is really in
# the node's containerd, retry once, and if it still isn't there fall back to
# registry-direct (helm values point at $RCA_IMAGE_PULL and the node pulls it
# from the registry itself — possible since the image is published multi-arch).
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
        # Pin the imported image (see pin_node_image in utils.sh) so k3d's own
        # image GC doesn't evict it between runs — falling back to a registry
        # pull every time is unnecessary churn for a published image this size.
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
            echo "    the cluster will pull ${RCA_IMAGE_PULL} from the registry instead."
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
    echo "⚠️  $RCA_IMAGE not found locally and the registry pull above failed — check"
    echo "    network access to the registry (ghcr.io). The RCA pod will stay"
    echo "    ImagePullBackOff. Continuing; other obs-plane components are unaffected."
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
  # REQUIRED from chart 1.2.0. The chart now fails its own render if any of
  # controlPlaneApiUrl / observer.extraEnvs / rca.openchoreoApiUrl still carries
  # its placeholder ".invalid" domain, and its DEFAULT extraEnvs does:
  # OBSERVER_BASE_URL=http://observer.openchoreo.invalid:11080. So the block has
  # to be supplied here even though only one of its two entries is really ours.
  #
  # extraEnvs REPLACES the chart's list rather than merging, so AUTHZ_TIMEOUT is
  # restated at the chart's own default — dropping it would silently shorten the
  # authorization timeout.
  #
  # Port 8080, not the chart's 11080: step 4 below disables the bundled
  # port-11080 Gateway (k3d's serverlb does not publish it) and routes the
  # observer through the main kgateway on :8080 by Host header instead.
  extraEnvs:
    - name: OBSERVER_BASE_URL
      value: "http://observer.openchoreo.localhost:8080"
    - name: AUTHZ_TIMEOUT
      value: "30s"
security:
  enabled: true
  oidc:
    # In-cluster addresses of the platform IdP, from env.sh (this heredoc expands).
    jwksUrl: "${THUNDER_INTERNAL_JWKS_URL}"
    tokenUrl: "${THUNDER_INTERNAL_TOKEN_URL}"
    authServerBaseUrl: "http://thunder.openchoreo.localhost:8080"
rca:
  # SRE / RCA agent. Vanilla, unforked OpenChoreo image (RCA_IMAGE_REPO/TAG,
  # step 1b above) — the generic EXTENSIONS_DIR mechanism (step 3e below)
  # replaces the old tharindulak/sre-agent fork's bespoke HANDOFF_* wiring
  # entirely.
  enabled: true
  image:
    repository: ${RCA_IMAGE_REPO}
    tag: ${RCA_IMAGE_TAG}
    pullPolicy: IfNotPresent          # imported/tagged locally in step 1b, not a bare registry pull
  llm:
    modelName: anthropic:claude-sonnet-4-6
  secretName: rca-agent-secret        # created in step 1b (RCA_LLM_API_KEY + OAUTH_CLIENT_SECRET)
  oauth:
    clientId: openchoreo-rca-agent    # registered by thunder-resources/86-openchoreo-rca-agent.yaml
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
# observer-config/rca-agent-config/the RCA agent deployment AFTER every
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
# Adapter image: AEP runs a patched build of the upstream 0.5.1 adapter whose
# alert-rule log matching is case-insensitive. The stock adapter compiles a
# rule into a case-SENSITIVE wildcard, so a rule watching "ERROR" silently
# stops firing the moment a code change rewords the log line to "error" — which
# is exactly what happened when a coding-agent PR detached an alert from the
# failure it was watching.
#
# Still not fixed upstream as of community-modules 0.5.4: BuildAlertQuery in
# internal/opensearch/queries.go emits a `wildcard` on `log` with no
# `case_insensitive: true`, unlike the log-LEVEL filter a few lines above it
# which does set the flag. So the fork stays.
#
# The fork is built from 0.5.1 while the CHART is now 0.5.3. That combination is
# verified: the 0.5.1 adapter reads 0.5.3's configuration correctly (OpenSearch
# address, index prefixes, observer URL) and reaches Ready. If a future chart
# does break it, clear OBS_LOGS_ADAPTER_IMAGE_REPO to fall back to the stock
# image and accept case-sensitive alert matching.
#
# Expect it to CrashLoopBackOff for the first minute or two of a fresh install:
# it refuses to start without OpenSearch, and OpenSearch is a large image and a
# slow boot. It recovers on its own once the StatefulSet is Ready.
if [ -n "$OBS_LOGS_ADAPTER_IMAGE_REPO" ]; then
    OBS_ADAPTER_IMAGE_BLOCK="  image:
    repository: ${OBS_LOGS_ADAPTER_IMAGE_REPO}
    tag: ${OBS_LOGS_ADAPTER_IMAGE_TAG}"
else
    OBS_ADAPTER_IMAGE_BLOCK="  # stock chart adapter image (case-SENSITIVE alert matching)"
fi
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
${OBS_ADAPTER_IMAGE_BLOCK}
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

# ── 3b. Alert→RCA auto-trigger + report-sink wiring ──────────────────────
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
#     HANDOFF_ENABLED          mirrors this script's own $HANDOFF_ENABLED, so a
#                              consumer that only has the ConfigMap (e.g.
#                              start.sh's crash-loop auto-recovery check) can
#                              still see whether the handoff stage is on —
#                              same value, same key name, no separate meaning.
#     REPORT_SINK              publish completed reports downstream (webhook)
#     REPORT_SINK_URL          full report endpoint on aep-api (:9090/api/v1/...)
#     (The RCA→platform handoff MECHANISM itself is no longer a ConfigMap key
#      set — see step 3e, which mounts mcp.json/CONTEXT.md/the
#      coding-agent-handoff skill via the generic EXTENSIONS_DIR mechanism
#      instead. Whether the filed issue is handed to the coding agent, vs.
#      left as a ledger entry for a human to adopt, is AEP_HANDOFF_ADOPT on
#      the aep-mcp-server deployment — see docker-compose.yml / helm values
#      aepMcpServer.handoffAdopt. Nothing on the SRE agent side controls it.)
echo ""
echo "3️⃣b Alert→RCA auto-trigger + report-sink wiring"
kubectl --context "$CLUSTER_CONTEXT" -n "$NS" patch cm observer-config --type=merge -p \
    '{"data":{"LOGS_ADAPTER_ENABLED":"true","RCA_SERVICE_URL":"http://'"${RCA_DEPLOYMENT}"':8080","ALERT_SUPPRESSION_WINDOW":"1h"}}'
kubectl --context "$CLUSTER_CONTEXT" -n "$NS" rollout restart deploy/observer
if [ "$HANDOFF_ENABLED" = "true" ]; then
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" patch cm rca-agent-config --type=merge -p \
        "{\"data\":{\"HANDOFF_ENABLED\":\"true\",\"REPORT_SINK\":\"${REPORT_SINK}\",\"REPORT_SINK_URL\":\"${REPORT_SINK_URL}\"}}"
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" rollout restart deploy/${RCA_DEPLOYMENT}
    echo "   Handoff: enabled via EXTENSIONS_DIR mount (mcp=${AEP_MCP_HOSTNAME})"
    echo "   Report sink: ${REPORT_SINK:-<none>} → ${REPORT_SINK_URL}"
else
    echo "   Handoff: disabled (HANDOFF_ENABLED=false)"
fi
kubectl --context "$CLUSTER_CONTEXT" -n "$NS" rollout status deploy/observer --timeout=300s

# ── 3c. observer-auth-config: service-account claim → client_id ───────────
# The observer resolves service accounts through its OWN copy of the
# entitlement mapping, separate from openchoreo-api-config, and it also ships
# keyed on `sub`. ThunderID puts a client_credentials subject in `client_id`
# (see setup-openchoreo.sh), so without this every build-log and observability
# query from a service account gets a 403.
#
# The configmap is populated ASYNCHRONOUSLY — it can exist before its
# service-account claim is written. Patching too early would see no `sub` and
# silently do nothing, so wait for the claim to surface first (either `sub` to
# patch, or `client_id` if a prior run already did it).
echo ""
echo "3️⃣c observer-auth-config service-account claim"
_obs_claim=""
for _ in $(seq 1 30); do
    _obs_claim="$(kubectl --context "$CLUSTER_CONTEXT" -n "$NS" get configmap observer-auth-config -o yaml 2>/dev/null \
        | grep -oE "claim:[[:space:]]*['\"]?(sub|client_id)['\"]?" | head -1)"
    [ -n "$_obs_claim" ] && break
    sleep 4
done
if [ -z "$_obs_claim" ]; then
    # Distinguish a genuinely-absent configmap from one that is present but
    # whose claim never surfaced, so the outcome is not misleading.
    if kubectl --context "$CLUSTER_CONTEXT" -n "$NS" get configmap observer-auth-config &>/dev/null; then
        echo "❌ observer-auth-config is present but its service-account claim never surfaced" >&2
        exit 1
    fi
    echo "   ⚠️  observer-auth-config not found — skipping"
elif echo "$_obs_claim" | grep -q client_id; then
    echo "   ✓ already client_id"
else
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" get configmap observer-auth-config -o yaml \
        | sed -E "s/claim:[[:space:]]*['\"]?sub['\"]?/claim: client_id/g" \
        | kubectl --context "$CLUSTER_CONTEXT" apply --server-side --field-manager=helm --force-conflicts -f - >/dev/null
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" rollout restart deployment/observer >/dev/null
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" rollout status deployment/observer --timeout=120s >/dev/null
    echo "   ✓ patched to client_id"
fi

if [ "$HANDOFF_ENABLED" = "true" ]; then
    # With HANDOFF_ENABLED=true the agent's boot-time MCP test is FATAL: it must
    # reach aep-mcp-server (docker-compose, started later by start.sh). Only
    # wait for readiness if that server is already up (i.e. setup is being
    # re-run on a live stack); on a fresh setup the crash-loop is expected
    # and start.sh auto-recovers the agent once compose is up.
    if curl -s --max-time 2 http://localhost:3401/healthz 2>/dev/null | grep -q '"ok"'; then
        kubectl --context "$CLUSTER_CONTEXT" -n "$NS" rollout status deploy/${RCA_DEPLOYMENT} --timeout=300s || \
            echo "⚠️  ${RCA_DEPLOYMENT} not ready — check the RCA image import in step 1b"
    else
        echo "ℹ️  aep-mcp-server not running yet — ${RCA_DEPLOYMENT} will crash-loop until"
        echo "    'bash scripts/start.sh' brings the compose stack up (start.sh then"
        echo "    auto-restarts the agent). This is expected on a fresh setup."
    fi
fi
echo "✅ auto-trigger + handoff wiring applied"

# ── 3d. Dynamic Anthropic key — reuse the org's key as set via the AE console ──
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
echo "3️⃣d Dynamic Anthropic key (ExternalSecret + volume wiring)"
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
kubectl --context "$CLUSTER_CONTEXT" -n "$NS" patch deployment ${RCA_DEPLOYMENT} --type=strategic -p '
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
        - name: '"${RCA_DEPLOYMENT}"'
          volumeMounts:
            - name: anthropic-key
              mountPath: /etc/rca-agent/anthropic
              readOnly: true
          env:
            - name: RCA_LLM_API_KEY_FILE
              value: /etc/rca-agent/anthropic/RCA_LLM_API_KEY
'
echo "✅ ${RCA_DEPLOYMENT} volume/env wired for the dynamic Anthropic key"
echo "   The RCA agent's own ExternalSecret (against the org's Anthropic KV path) fills this mount."
echo "   Until one exists it falls back to the static RCA_LLM_API_KEY from step 1b."

# ── 3e. SRE-agent extensions (mcp.json + CONTEXT.md + coding-agent-handoff skill) ──
# The remediation agent's handoff to AE runs on OpenChoreo's generic
# EXTENSIONS_DIR mechanism (openchoreo#4743): one ConfigMap holding
# mcp.json (points the agent at aep-mcp-server, AEP_MCP_HOSTNAME/
# AEP_MCP_TOKEN substituted), CONTEXT.md (the unconditional handoff
# trigger), and the coding-agent-handoff skill — mounted at
# EXTENSIONS_DIR/remediation/ (the agent's default EXTENSIONS_DIR, no env
# override needed). mcp.json/CONTEXT.md are deployment-owned
# (deployments/sre-agent-extensions/remediation/); the skill's canonical
# source stays services/aep-mcp-server/skills/coding-agent-handoff/SKILL.md
# — read straight off this checkout (unlike aectl, which is a standalone
# binary and must vendor+embed the same three files at build time; see
# tools/aectl/cmd/sre_extensions.go). Mirrors that same mounting shape here
# in bash. Same "patch the Deployment so it survives a helm re-run" pattern
# as step 3c's volume wiring.
#
# Only wired when HANDOFF_ENABLED=true — without the handoff stage the agent
# never loads a skill, so there's nothing to mount.
#
# ⚠️  UPGRADING AN EXISTING DEPLOYMENT: an older version of this script wrote
# a per-skill `rca-agent-skill-<name>` ConfigMap plus a `<name>-skill`
# volume/volumeMount for each skill under services/aep-mcp-server/skills/
# (EXTERNAL_SKILLS_DIR-based loading), and an even older version wrote a
# `rca-agent-handoff-provider` ConfigMap plus a `handoff-provider`
# volume/volumeMount (a provider-descriptor mount). This step creates
# neither — the single sre-agent-extensions ConfigMap below replaces both —
# so on a cluster where an older script already ran, those are now ORPHANED:
# nothing here deletes them, and they are harmless but stale. Clean them up
# by hand, once, on such a cluster:
#   kubectl delete configmap rca-agent-handoff-provider -n "$NS" --ignore-not-found
#   kubectl get configmap -n "$NS" -o name | grep '^configmap/rca-agent-skill-' | xargs -r kubectl delete -n "$NS"
#   kubectl edit deployment "$RCA_DEPLOYMENT" -n "$NS"   # remove the handoff-provider
#                                                          # and any <name>-skill
#                                                          # volumes/volumeMounts
# (or apply an equivalent strategic-merge patch). Not run automatically here:
# this script does not delete or patch away resources it does not itself own
# the full lifecycle of.
if [ "$HANDOFF_ENABLED" = "true" ]; then
    echo ""
    echo "3️⃣e SRE-agent extensions — mcp.json + CONTEXT.md + coding-agent-handoff skill"
    EXT_ROOT="$SCRIPT_DIR/../sre-agent-extensions/remediation"
    SKILL_MD="$SCRIPT_DIR/../../services/aep-mcp-server/skills/coding-agent-handoff/SKILL.md"
    if [ ! -f "$SKILL_MD" ]; then
        echo "❌ $SKILL_MD not found — the coding-agent-handoff skill is the handoff"
        echo "   stage's whole playbook. The agent's config validator refuses to start"
        echo "   without EXTENSIONS_DIR content, and an empty mount fails load_skill"
        echo "   once per incident — the report then records only that the stage failed."
        exit 1
    fi
    RENDERED_MCP_JSON=$(sed \
        -e "s|\${AEP_MCP_HOSTNAME}|${AEP_MCP_HOSTNAME}|g" \
        -e "s|\${AEP_MCP_TOKEN}|${AEP_MCP_TOKEN}|g" \
        "$EXT_ROOT/mcp.json")

    # Render deterministically (create --dry-run) then apply, so re-runs are
    # idempotent and the ConfigMap can be diffed.
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" create configmap sre-agent-extensions \
        --from-literal="mcp.json=${RENDERED_MCP_JSON}" \
        --from-file="CONTEXT.md=$EXT_ROOT/CONTEXT.md" \
        --from-file="SKILL.md=$SKILL_MD" \
        --dry-run=client -o yaml | kubectl --context "$CLUSTER_CONTEXT" apply -f - >/dev/null
    echo "✅ sre-agent-extensions ConfigMap applied"

    # ConfigMap keys can't hold '/', so `items` maps each flat key back onto
    # its EXTENSIONS_DIR subpath. Deployment name and container name are both
    # $RCA_DEPLOYMENT in this script's own chart usage (see the header) — a
    # strategic-merge patch on a volume/volumeMount by name is safe to
    # re-apply, so this is idempotent across re-runs.
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" patch deployment "$RCA_DEPLOYMENT" --type=strategic -p '{
        "spec": {"template": {"spec": {
            "volumes": [{
                "name": "sre-agent-extensions",
                "configMap": {
                    "name": "sre-agent-extensions",
                    "items": [
                        {"key": "mcp.json", "path": "remediation/mcp.json"},
                        {"key": "CONTEXT.md", "path": "remediation/CONTEXT.md"},
                        {"key": "SKILL.md", "path": "remediation/skills/coding-agent-handoff/SKILL.md"}
                    ]
                }
            }],
            "containers": [{"name": "'"$RCA_DEPLOYMENT"'", "volumeMounts": [
                {"name": "sre-agent-extensions", "mountPath": "/etc/openchoreo/sre-agent"}
            ]}]
        }}}
    }'
    echo "✅ sre-agent-extensions volume mounted on deployment/$RCA_DEPLOYMENT"
    echo "   Edit services/aep-mcp-server/skills/coding-agent-handoff/SKILL.md or"
    echo "   deployments/sre-agent-extensions/remediation/{mcp.json,CONTEXT.md}, then"
    echo "   re-run this script and restart the agent — no SRE image rebuild."

    # ── 3f. Route + DNS + cert trust for aep-mcp.openchoreo.localhost ────
    # The extensions loader (openchoreo#4743) rejects a headered mcp.json
    # server over plain http, so AEP_MCP_HOSTNAME above is an https URL —
    # which needs, all four together: (a) a Gateway https listener actually
    # serving *.openchoreo.localhost (setup-openchoreo.sh's
    # create_gateway_tls_cert call + values-cp.yaml's gateway.tls), (b) DNS
    # for THIS specific hostname resolving to that gateway rather than the
    # data-plane one every other *.openchoreo.localhost name uses, (c) a
    # route from the gateway to aep-mcp-server — which for this docker-compose
    # local-dev path lives on the HOST, not as an in-cluster Service, and (d)
    # the remediation agent trusting the gateway's self-signed cert without
    # losing trust in api.anthropic.com's real one. Each was found missing,
    # one at a time, running this end to end — see
    # docs/design/draft/2026-09-17-sre-agent-extensions-handoff.md §6.
    echo ""
    echo "3️⃣f Route + DNS + cert trust for aep-mcp.openchoreo.localhost"

    # (b) DNS: the blanket `openchoreo.override` rewrite (setup-k3d.sh) sends
    # every *.openchoreo.localhost name to the DATA-plane gateway. One
    # hostname already overrides that blanket rule with its own priority file
    # (0-platform-idp.override, for thunder.openchoreo.localhost) — same
    # pattern here, sent to the CONTROL-plane gateway instead, where (a)'s
    # listener actually lives. The "0-" prefix is load-bearing: CoreDNS
    # applies these override files in name order, and this one must win over
    # the un-prefixed blanket rule.
    kubectl --context "$CLUSTER_CONTEXT" -n kube-system patch configmap coredns-custom --type merge -p '{
        "data": {
            "0-aep-mcp.override": "rewrite stop {\n  name regex aep-mcp\\.openchoreo\\.localhost gateway-default.openchoreo-control-plane.svc.cluster.local\n  answer auto\n}\n"
        }
    }' >/dev/null
    kubectl --context "$CLUSTER_CONTEXT" -n kube-system rollout restart deployment/coredns >/dev/null
    kubectl --context "$CLUSTER_CONTEXT" -n kube-system rollout status deployment/coredns --timeout=60s >/dev/null
    echo "✅ DNS override applied (aep-mcp.openchoreo.localhost → control-plane gateway)"

    # (c) Route: aep-mcp-server is docker-compose's, reached in-cluster via
    # host.k3d.internal — but Gateway API backendRefs need a real Service with
    # real Endpoints; kgateway does not resolve a `type: ExternalName` Service
    # (its HTTPRoute status reports the Service "not found", the same
    # not-a-real-backend gap several Gateway API implementations have). A
    # headless Service + a hand-written EndpointSlice pointing at
    # host.k3d.internal's own resolved IP is the standard workaround, and that
    # IP is already the one setup-k3d.sh recorded for its own
    # host-k3d-internal.server CoreDNS block — read it from there rather than
    # re-resolving it, so this can't silently drift from what DNS-based
    # lookups of host.k3d.internal actually return.
    K3D_HOST_IP=$(kubectl --context "$CLUSTER_CONTEXT" get configmap coredns-custom -n kube-system \
        -o jsonpath='{.data.host-k3d-internal\.server}' | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | head -1)
    if [ -z "$K3D_HOST_IP" ]; then
        echo "❌ could not read host.k3d.internal's IP from coredns-custom's host-k3d-internal.server key" >&2
        echo "   (written by setup-k3d.sh) — is the cluster set up via this repo's scripts?" >&2
        exit 1
    fi
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: aep-mcp-server-external
  namespace: $NS
spec:
  clusterIP: None
  ports:
    - port: 3401
      targetPort: 3401
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: aep-mcp-server-external
  namespace: $NS
  labels:
    kubernetes.io/service-name: aep-mcp-server-external
addressType: IPv4
ports:
  - port: 3401
endpoints:
  - addresses:
      - "$K3D_HOST_IP"
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: aep-mcp-mainkgw
  namespace: $NS
spec:
  parentRefs:
    - name: gateway-default
      namespace: openchoreo-control-plane
      sectionName: https
  hostnames:
    - aep-mcp.openchoreo.localhost
  rules:
    - matches:
        - path: { type: PathPrefix, value: / }
      backendRefs:
        - name: aep-mcp-server-external
          port: 3401
      timeouts:
        request: "0s"
        backendRequest: "0s"
EOF
    echo "✅ Route to aep-mcp-server applied (via host.k3d.internal, $K3D_HOST_IP:3401)"

    # (d) Cert trust: SSL_CERT_FILE replaces the default trust store rather
    # than extending it, so pointing it at ONLY the control-plane gateway's
    # self-signed CA would make the remediation agent stop trusting
    # api.anthropic.com too (found the hard way — its startup LLM test failed
    # with a generic "Connection error" the first time this was tried). The
    # fix is a combined bundle: the image's own certifi CA store, with the
    # gateway's CA appended — never handwritten, since certifi's exact
    # contents are the RCA image's, not this script's, to know.
    if [ ! -f "$CP_GATEWAY_CA_FILE" ]; then
        echo "❌ $CP_GATEWAY_CA_FILE not found — setup-openchoreo.sh's create_gateway_tls_cert" >&2
        echo "   call for openchoreo-control-plane must run before this script." >&2
        exit 1
    fi
    CERT_EXTRACT_POD="cert-extract-tmp"
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" delete pod "$CERT_EXTRACT_POD" --ignore-not-found >/dev/null 2>&1
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" run "$CERT_EXTRACT_POD" \
        --image="${RCA_IMAGE_REPO}:${RCA_IMAGE_TAG}" --restart=Never \
        --command -- python3 -c "import certifi; print(open(certifi.where()).read())" >/dev/null
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" wait --for=jsonpath='{.status.phase}'=Succeeded \
        "pod/$CERT_EXTRACT_POD" --timeout=60s >/dev/null
    COMBINED_CA_TMP="$(mktemp)"
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" logs "$CERT_EXTRACT_POD" > "$COMBINED_CA_TMP"
    cat "$CP_GATEWAY_CA_FILE" >> "$COMBINED_CA_TMP"
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" delete pod "$CERT_EXTRACT_POD" --ignore-not-found >/dev/null 2>&1
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" create configmap aep-mcp-gateway-ca \
        --from-file=ca.crt="$COMBINED_CA_TMP" \
        --dry-run=client -o yaml | kubectl --context "$CLUSTER_CONTEXT" -n "$NS" apply -f - >/dev/null
    rm -f "$COMBINED_CA_TMP"
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" patch deployment "$RCA_DEPLOYMENT" --type=strategic -p '{
        "spec": {"template": {"spec": {
            "volumes": [{
                "name": "aep-mcp-gateway-ca",
                "configMap": {"name": "aep-mcp-gateway-ca"}
            }],
            "containers": [{"name": "'"$RCA_DEPLOYMENT"'",
                "volumeMounts": [{"name": "aep-mcp-gateway-ca", "mountPath": "/etc/ssl/aep-mcp-ca"}],
                "env": [{"name": "SSL_CERT_FILE", "value": "/etc/ssl/aep-mcp-ca/ca.crt"}]
            }]
        }}}
    }' >/dev/null
    echo "✅ Combined CA bundle (certifi + control-plane gateway CA) mounted, SSL_CERT_FILE set"
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
    # client_id, not sub: ThunderID puts a client_credentials token's subject in
    # the client_id claim. Same move as every other service-account binding
    # (setup-openchoreo.sh, setup-aep.sh) — this one lives here because the
    # observer role is only meaningful once the observability plane exists.
    claim: client_id
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
