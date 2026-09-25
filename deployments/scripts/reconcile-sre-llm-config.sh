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
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
# WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

# Local-dev bridge: make the SRE agent consume the platform-wide SRE LLM
# config set via the AE Console (Settings > Credentials > SRE agent), when
# one has been set. Read-only against the org's default Anthropic wiring:
# when nothing has been configured, this script does nothing and the
# existing reconcile-sre-anthropic-externalsecret.sh path is unaffected.
#
#   AE Console sreLlm setting
#     -> platform_sre_llm_config (Postgres) + its secret_ref_kv_path
#     -> ExternalSecret openchoreo-observability-plane/sre-llm-secret
#     -> Deployment volume sre-llm-key -> RCA_LLM_API_KEY_FILE
#
# Idempotent and safe to re-run; called from setup-observability.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
source "$SCRIPT_DIR/env.sh"

NS="${SRE_AGENT_NAMESPACE:-openchoreo-observability-plane}"
RCA_DEPLOYMENT="${RCA_DEPLOYMENT:-sre-agent}"
DB_CONTAINER="${AEP_DB_CONTAINER:-aep-db}"
SECRET_NAME="sre-llm-secret"
SECRET_KEY="RCA_LLM_API_KEY"
REMOTE_PROPERTY="api-key"

CURRENT_CTX="$(kubectl config current-context 2>/dev/null || true)"
if [ -z "$CURRENT_CTX" ] || [ "$CURRENT_CTX" != "$CLUSTER_CONTEXT" ]; then
    echo "⚠️  reconcile-sre-llm-config: current kubectl context ($CURRENT_CTX) != $CLUSTER_CONTEXT — refusing to run."
    exit 1
fi

if ! kubectl --context "$CLUSTER_CONTEXT" get namespace "$NS" >/dev/null 2>&1; then
    echo "ℹ️  $NS does not exist yet — skipping SRE LLM config reconcile."
    exit 0
fi

row=""
if docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    row="$(docker exec "$DB_CONTAINER" psql -U aep -d aep -At -F'|' \
        -c "select provider, model, coalesce(secret_ref_kv_path, '') from platform_sre_llm_config where id=1 limit 1;" 2>/dev/null || true)"
fi

if [ -z "$row" ]; then
    # No row (never configured, or disconnected via the Console). Revert the
    # delivery layer back to the default Anthropic wiring and clean up any
    # ExternalSecret this script created earlier. Idempotent: harmless no-op
    # when nothing was ever patched/created.
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" patch deployment "${RCA_DEPLOYMENT}" --type=strategic -p '
spec:
  template:
    spec:
      containers:
        - name: '"${RCA_DEPLOYMENT}"'
          env:
            - name: RCA_LLM_API_KEY_FILE
              value: /etc/rca-agent/anthropic/RCA_LLM_API_KEY
' >/dev/null 2>&1 || true

    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" delete externalsecret "$SECRET_NAME" --ignore-not-found >/dev/null

    echo "ℹ️  No SRE agent LLM config set in the AE Console — reverted to the default Anthropic wiring."
    exit 0
fi

provider="$(printf '%s' "$row" | cut -d'|' -f1)"
model="$(printf '%s' "$row" | cut -d'|' -f2)"
kv_path="$(printf '%s' "$row" | cut -d'|' -f3)"

if [ -z "$kv_path" ]; then
    echo "ℹ️  SRE agent LLM config is set but not yet mirrored to OpenBao (SM-API unavailable?) — leaving the default wiring in place."
    exit 0
fi

# 1. ExternalSecret sourcing the ESO Secret from the stored OpenBao path.
kubectl --context "$CLUSTER_CONTEXT" apply -f - <<EOF >/dev/null
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: ${SECRET_NAME}
  namespace: ${NS}
  labels:
    app.kubernetes.io/managed-by: aep-local-setup
    aep.wso2.com/source: ae-sre-llm-config
spec:
  refreshInterval: 15s
  secretStoreRef:
    kind: ClusterSecretStore
    name: default
  target:
    name: ${SECRET_NAME}
    creationPolicy: Owner
  data:
    - secretKey: ${SECRET_KEY}
      remoteRef:
        key: ${kv_path}
        property: ${REMOTE_PROPERTY}
EOF

# 2. Ensure the second, independent volume/mount exists (idempotent patch;
#    optional secret so this is safe even before ESO materialises it).
kubectl --context "$CLUSTER_CONTEXT" -n "$NS" patch deployment "${RCA_DEPLOYMENT}" --type=strategic -p '
spec:
  template:
    spec:
      volumes:
        - name: sre-llm-key
          secret:
            secretName: '"${SECRET_NAME}"'
            optional: true
            defaultMode: 0400
      containers:
        - name: '"${RCA_DEPLOYMENT}"'
          volumeMounts:
            - name: sre-llm-key
              mountPath: /etc/rca-agent/sre-llm
              readOnly: true
          env:
            - name: RCA_LLM_API_KEY_FILE
              value: /etc/rca-agent/sre-llm/RCA_LLM_API_KEY
' >/dev/null

# 3. Model name — no live-sync path, so patch the ConfigMap AND restart only
#    when the value actually changed (avoid an unnecessary rollout on every
#    idempotent re-run).
model_name="${provider}:${model}"
current_model="$(kubectl --context "$CLUSTER_CONTEXT" -n "$NS" get configmap rca-agent-config -o jsonpath='{.data.RCA_MODEL_NAME}' 2>/dev/null || true)"
if [ "$current_model" != "$model_name" ]; then
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" patch configmap rca-agent-config --type=merge \
        -p "{\"data\":{\"RCA_MODEL_NAME\":\"${model_name}\"}}" >/dev/null
    kubectl --context "$CLUSTER_CONTEXT" -n "$NS" rollout restart "deploy/${RCA_DEPLOYMENT}" >/dev/null
    echo "✅ SRE agent LLM config reconciled: ${model_name} (model changed — restarted ${RCA_DEPLOYMENT})"
else
    echo "✅ SRE agent LLM config reconciled: ${model_name} (unchanged)"
fi
