# Can an AE-owned `rca-agent-secret` override the RCA model and base URL?

Ticket: tharindulak/labs-agentic-engineer#5 (map #2). Target: OpenChoreo `v1.3.0`
(tag object `7db07e6b`). Baseline: local OpenChoreo 1.2.x checkout.

## Answer

**No for `RCA_MODEL_NAME`. Only conditionally for `RCA_LLM_BASE_URL`.** The Secret
is the *first* `envFrom` source and the chart's `rca-agent-config` ConfigMap is
the *second*, so the ConfigMap wins on every duplicate key.

- `RCA_MODEL_NAME` is always written to the ConfigMap, even when
  `rca.llm.modelName` is `""`. A key with an empty value still counts as present,
  so a Secret value is always overridden.
- `RCA_LLM_BASE_URL` is written to the ConfigMap only when `rca.llm.baseUrl` is
  non-empty. The Secret's value takes effect only while that Helm value stays
  empty. That depends on whoever owns the chart values, so it is fragile.

The supported override is `rca.extraEnvs`, which renders as container `env`.
`env` beats every `envFrom` source. An entry can be a literal or use
`valueFrom.secretKeyRef` / `configMapKeyRef` to point at an AE-owned object. The
other option is to set `rca.llm.modelName` / `rca.llm.baseUrl` directly, which
is how AE sets the model today (`tools/aectl/cmd/sre_assets.go:122-123`).

## Evidence

### Chart wiring (v1.3.0, unchanged from 1.2.x)

`install/helm/openchoreo-observability-plane/templates/sre-agent/deployment.yaml@v1.3.0`:

- `:67-71` sets `envFrom: [secretRef: {{ .Values.rca.secretName }}, configMapRef: rca-agent-config]`, in that order.
- `:72-75` renders `env:` from `.Values.rca.extraEnvs` only when it is non-empty.
- `:28` puts `checksum/config` over the ConfigMap template only. Nothing hashes the Secret, so a Secret change does not roll the pod.
- `:2-4` fails the render when `rca.secretName` is empty. The error message names the expected Secret keys: `RCA_LLM_API_KEY`, `OAUTH_CLIENT_SECRET`, and optionally `SQL_BACKEND_URI`.

`templates/sre-agent/rca-agent-config.yaml@v1.3.0`:

- `:13` writes `RCA_MODEL_NAME: {{ .Values.rca.llm.modelName | quote }}` with no condition.
- `:14-16` writes `RCA_LLM_BASE_URL` only when `rca.llm.baseUrl` is set.

`values.yaml@v1.3.0`:

- `:1596` sets `secretName: "rca-agent-secret"`.
- `:1602-1615` holds `llm.modelName` and `llm.baseUrl`, both defaulting to `""`.
- `:1680-1693` defines `extraEnvs: []`, with a schema of `name` and `value` items.

In `values.schema.json@v1.3.0`, `rca.extraEnvs.items` sets no
`additionalProperties: false`, so `valueFrom` entries pass validation. `rca.llm`
does set `additionalProperties: false`, so it accepts only `modelName` and `baseUrl`.

The baseline 1.2.x `deployment.yaml:67-75` has the same order and the same `extraEnvs` block.

### Kubernetes precedence

- API contract, from `k8s.io/api` `core/v1/types.go`, the `Container.EnvFrom` doc comment: "When a key exists in multiple sources, the value associated with the last source will take precedence. Values defined by an Env with a duplicate key will take precedence." Source: https://github.com/kubernetes/api/blob/master/core/v1/types.go
- Kubelet implementation, from `pkg/kubelet/kubelet_pods.go` (`makeEnvironmentVariables`): it loops over `EnvFrom` in order, writing each key into `tmpEnv` (later writes replace earlier ones). It then loops over `Env`, which is commented "Env will override EnvFrom variables". Source: https://github.com/kubernetes/kubernetes/blob/master/pkg/kubelet/kubelet_pods.go
- Env vars are resolved once, at container start. A changed Secret or ConfigMap reaches the process only after a restart. Docs: https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/

These links point at `master`. The behaviour has been part of the stable API contract for many releases.

### Agent settings loader: no `.env` or secrets-dir interference

- `agents/sre-agent/src/config.py@v1.3.0:13-22` defines `Settings(CommonSettings)` with `env_file=".env"` and the fields `rca_model_name`, `rca_llm_api_key` and `rca_llm_base_url`, all defaulting to `""`. `agents/common/src/common/config.py@v1.3.0:7-12` is the same. Neither sets `secrets_dir`.
- In pydantic-settings (the lock pins `>=2.14.2`), the default source order is `init_settings, env_settings, dotenv_settings, file_secret_settings`, and earlier sources win (`pydantic_settings/main.py@v2.14.2:271`). So a real env var always beats a `.env` value. `secrets_dir` is read only when it is configured (`main.py:373`).
- `agents/sre-agent/Dockerfile@v1.3.0:46-48` copies only `/app/.venv` and `/app/src` into the distroless image, with `WORKDIR /app`. No `/app/.env` ships, and the Deployment mounts nothing at `/app` except `/app/data` (sqlite PVC). A missing `env_file` is skipped.
- `agents/sre-agent/src/clients/llm.py@v1.3.0:15-24` shows how the values are used: `model_name`/`api_key` default from settings, and `base_url` is passed only when `rca_llm_base_url` is truthy.

So the process environment is the only input that matters, and Kubernetes decides it as described above.

### Co-owning the Secret with ESO

AE today (`tools/aectl/cmd/sre_assets.go:42-58`) has one `ExternalSecret` named
`rca-agent-secret`, with the default `creationPolicy: Owner` and two `data`
entries. They map `RCA_LLM_API_KEY` from OpenBao `aep/anthropic-api-key` and
`OAUTH_CLIENT_SECRET` from `aep/thunder-clients/openchoreo-rca-agent`. Values are
not reproduced here.

ESO facts (`apis/externalsecrets/v1/externalsecret_types.go`, checked at `v2.11.0` and `main`):

- `creationPolicy` enum: `Owner` (default), `Orphan`, `Merge` (does not create, merges into an existing Secret), `None`, and `CreateOrMerge`. `CreateOrMerge` is present at `v2.11.0` and not in older releases, so check the ESO version installed on the cluster before relying on it. Source: https://external-secrets.io/latest/api/externalsecret/
- `target.template.mergePolicy`: `Replace` (default) or `Merge`. With `Merge`, the fetched `data` keys are kept and `template.data` keys are added, with template keys winning (`externalsecret_types.go:126-144`; https://external-secrets.io/latest/guides/templating/). A `template.data` value is a Go template, so a string with no actions renders as a literal. That is how non-secret keys get into the same Secret.
- Adding `SQL_BACKEND_URI` is one more `data` entry with its own `remoteRef` in the same `ExternalSecret`.

Recommended ownership: keep a **single** `Owner` `ExternalSecret` for
`rca-agent-secret`, and add keys as extra `data` entries (or `template.data`
with `mergePolicy: Merge`). A second `ExternalSecret` on the same target would
need `creationPolicy: Merge` and would race on refresh. The ESO docs do not
describe two `Owner` ExternalSecrets on one target, so avoid that setup.

Even with this in place, a model or base URL key in the Secret still loses to
the ConfigMap. Use the Secret for credentials only.

## Conditions and caveats

1. A `RCA_LLM_BASE_URL` in the Secret works only while `rca.llm.baseUrl` is empty.
   If a future chart version starts emitting it unconditionally, the override
   silently stops working.
2. `extraEnvs` replaces the list and does not merge with it. AE must own the whole
   `rca.extraEnvs` value in its Helm values. The v1.3.0 default is `[]`.
3. A Secret or `extraEnvs`→Secret change needs a pod restart, because
   `checksum/config` does not cover the Secret. ESO `refreshInterval` is `1h`
   (`sre_assets.go:48`).
4. When `baseUrl` points at a gateway, the chart says `RCA_LLM_API_KEY` "may be a
   placeholder" (`values.yaml@v1.3.0:1612`). The key must still exist in the
   Secret, because the render fails on a missing `secretName`, and the agent
   reads the key as a string.
