# How aep-api reaches the observability plane to push and restart

Ticket: tharindulak/labs-agentic-engineer#6 (map #2). Target: OpenChoreo `v1.3.0`
(checkout at commit `178dfbd`, tag `v1.3.0`). AE: `main` at `ba9fe6b8`.
OC paths below are relative to the OpenChoreo repo at `v1.3.0`; AE paths are
relative to this repo.

## Answer

- **Topology.** Every AE install path today puts the observability plane (OP)
  in **aep-api's own cluster**, in namespace `openchoreo-observability-plane`.
  Upstream OC also supports a **remote OP cluster**, reachable only through the
  OP cluster-agent's outbound WebSocket. AE has no install path for that
  topology, and none of the candidate write paths works there without a new
  component.
- **Write path.** OC v1.3.0 has no API that delivers a secret to the OP:
  `SecretReference` and the Secrets API only target Data/Workflow planes. That
  leaves (a) OpenBao + ESO and (c) the Kubernetes API directly. Both need a
  Kubernetes permission in the OP namespace for the restart anyway.
- **Recommendation: (c) a namespaced, name-scoped Role.** aep-api updates one
  AE-owned Secret (`sre-agent-llm`, keys for the API key, model, and base URL),
  which the agent reads through `rca.extraEnvs` `secretKeyRef` (see #5). It then
  patches a pod-template annotation on the one Deployment. The update is
  synchronous, so there is no race with ESO refresh, no OpenBao policy change,
  and no third-party controller. `aectl sre install` creates the Secret and the
  RoleBinding.
- **Restart.** Nothing restarts the pod on a Secret change: env vars are fixed
  at container start, ESO does not roll pods, and the chart's checksum only
  covers the ConfigMap. aep-api must patch the pod template itself, the same
  way `aectl` already does. Reloader would do the job but adds a cluster-wide
  third-party controller. Not recommended.
- **Bad key.** The agent's lifespan probe raises and uvicorn exits with code 3
  before binding the port, so the pod goes into `CrashLoopBackOff`. With the
  default `sqlite` backend the Deployment uses `Recreate`, so a bad key means
  **an outage, not a stalled rollout**. aep-api must validate the key first
  (existing `POST /config/llm/test`) and then watch Deployment and Pod status.

## 1. Topologies

| | Where the OP runs | How AE reaches it | Evidence |
|---|---|---|---|
| T1 single cluster (all AE installs today) | Same cluster as aep-api, ns `openchoreo-observability-plane` | In-cluster Kubernetes API, Service DNS | `deployments/scripts/setup-env-for-aectl.sh:1158-1245` installs the OP charts into the one k3d cluster (`:159`). `aectl sre install` uses a single kubeconfig for everything (`tools/aectl/cmd/sre.go:125-134`) and defaults `--obs-namespace openchoreo-observability-plane` and an in-cluster OpenBao address (`sre.go:94-95`). |
| T2 remote OP cluster (upstream OC supports it; AE does not install it) | Its own cluster | Only via the OP cluster-agent's outbound WebSocket to the CP cluster-gateway. The OP's Kubernetes API is not exposed. The OP cluster has **its own OpenBao** and `ClusterSecretStore`. | `install/k3d/multi-cluster/README.md:10-12` ("Secured with mTLS, no need to expose Kubernetes APIs externally"), `:485-491` (OpenBao installed on the OP cluster). |
| T3 WSO2 Cloud (private overlay) | Not visible in this repo | aep-api uses a different `SecretsProvider` (SM-API). OpenBao-direct is local-only. | `deployments/helm-charts/platform/templates/aep-api/deployment.yaml:198-212`. **Unverified**: where the OP runs in Cloud needs checking with the Cloud overlay owners. |

aep-api already has a seam for a remote kube API: `KUBE_API_BASE_URL` plus token
and CA, written for split-plane ThunderApplication reads
(`services/aep-api/internal/config/config_loader.go:274-282`). Using it for a
remote OP would mean exposing that cluster's API server and handing aep-api a
long-lived credential for it, which goes against OC's agent model.

## 2. Candidate write paths

### (a) aep-api writes OpenBao; an ExternalSecret delivers it

- aep-api already writes OpenBao directly when OpenBao-direct is on. The path is
  `secret/user-app-secrets/<OrgBaseNamespace(orgUUID)>/<entity>-secrets`
  (`services/aep-api/internal/clients/secretmanagersvc/providers/openbao/client.go:34-59`,
  `secretsprovider/types.go:205-220`). The org model connection key is already
  stored as entity `model-connection`
  (`internal/organization/entity_org_model_connection.go:31`,
  `secret_ref_writer.go:103-120`).
- Today's `rca-agent-secret` ExternalSecret reads the platform key
  `aep/anthropic-api-key` with `refreshInterval: 1h`
  (`tools/aectl/cmd/sre_assets.go:43-58`). `aectl platform install` writes that
  path (`tools/aectl/cmd/platform.go:834-835`).
- Costs:
  - A pushed value reaches the pod only after ESO refreshes. Waiting up to the
    `refreshInterval` is too slow, so aep-api must force a sync with the
    `force-sync` annotation, wait for the target Secret to change, then
    restart. That needs `patch` on `externalsecrets` and `get` on the Secret in
    the OP namespace, **in addition to** the Deployment patch. So (a) needs
    OpenBao write access *and* Kubernetes access, not one or the other.
  - Restarting before ESO has synced starts the pod with the old key. That is a
    real race to handle.
  - It only works where aep-api has OpenBao-direct (local). In Cloud the store
    is SM-API (T3).
  - In T2 the OP's ESO reads the OP cluster's OpenBao, not AE's.

### (b) SecretReference or Secrets through the OC API: not possible in v1.3.0

- `SecretReference.spec.targetPlane.kind` is an enum of
  `WorkflowPlane|ClusterWorkflowPlane|DataPlane|ClusterDataPlane`
  (`api/v1alpha1/secretreference_types.go:62-73`).
- The SecretReference controller is a scaffold no-op
  (`internal/controller/secretreference/controller.go:36-42`). Only the
  ReleaseBinding and WorkflowRun controllers consume it
  (`internal/controller/releasebinding/controller.go:374-406`).
- The Secrets API (`POST /api/v1alpha1/namespaces/{ns}/secrets`) takes the same
  `TargetPlaneRef` enum (`openapi/openchoreo-api.yaml:13075-13080`,
  `CreateSecretRequest` `:13097-13115`).
- aep-api's `upsertSecretReference` always authors in the org's CP namespace for
  a Component consumer
  (`services/aep-api/internal/clients/secretmanagersvc/client.go:167-201`).
  Nothing renders that into the OP.
- A workaround exists: a ComponentType or Trait resource with
  `targetPlane: observabilityplane` goes through a RenderedRelease to the OP
  cluster-agent (`internal/controller/renderedrelease/controller.go:109-150`),
  whose ClusterRole allows `secrets: *` and `deployments: patch`
  (`install/helm/openchoreo-observability-plane/templates/cluster-agent/clusterrole.yaml:11-14,38-44`).
  **Rejected as a hack**: it models the SRE agent's config as an OC Component
  in an Environment, and it would server-side-apply over a Helm-owned
  Deployment. It is the only in-band channel to a T2 OP, though, so it is worth
  keeping in mind if OC ever exposes an OP secret API.

### (c) aep-api calls the Kubernetes API with a namespaced Role

- aep-api already runs with an in-cluster ServiceAccount and a raw kube client
  (ThunderApplication LIST, `internal/clients/thunderapp/client.go:48`).
- Minimum Role in `openchoreo-observability-plane`, bound to SA
  `<aep-ns>/aep-api`:

  | apiGroup | resource | verbs | resourceNames | why |
  |---|---|---|---|---|
  | `""` | secrets | get, update, patch | `sre-agent-llm` | write the key, model, and base URL |
  | `apps` | deployments | get, patch | `sre-agent` | pod-template annotation restart; read rollout status |
  | `""` | pods | list | none (list cannot be name-scoped) | detect `CrashLoopBackOff` on the new ReplicaSet's pods |

- `create` cannot be restricted by `resourceNames`
  ([RBAC docs, "Referring to resources"](https://kubernetes.io/docs/reference/access-authn-authz/rbac/#referring-to-resources)).
  So `aectl sre install` pre-creates `sre-agent-llm`, and aep-api only updates
  it. `list`/`watch` on Secrets would expose every Secret in the namespace, so
  the Role grants neither
  ([Secret good practice](https://kubernetes.io/docs/concepts/configuration/secret/#configure-least-privilege-access-to-secrets)).
- Use a **separate** Secret, not `rca-agent-secret`. That one has an ESO
  `Owner` ExternalSecret that would overwrite aep-api's write on the next
  refresh. The chart only reads `rca.secretName` through `envFrom`
  (`templates/sre-agent/deployment.yaml:67-71`), so the AE-owned Secret is wired
  through `rca.extraEnvs` with `valueFrom.secretKeyRef` for `RCA_LLM_API_KEY`,
  `RCA_MODEL_NAME` and `RCA_LLM_BASE_URL`. `env` beats both `envFrom` sources,
  as established in #5.
- Works in T1 only.

### Comparison

| | (a) OpenBao + ESO | (c) Role + Secret |
|---|---|---|
| New privilege | OpenBao write on a path (needs a scoped policy) + k8s `patch` on ExternalSecret + Deployment + `list` Pods | k8s update/patch on one named Secret + one named Deployment + `list` Pods |
| Synchronous | No: ESO refresh race | Yes |
| Moving parts | OpenBao, ESO, SecretStore auth, Kubernetes | Kubernetes |
| Where the value lives | OpenBao, then a k8s Secret (ESO copy) | k8s Secret (same end state as (a)) |
| T1 / T2 / T3 | yes / no / no (SM-API) | yes / no / only if Cloud runs the OP beside aep-api (unverified) |

## 3. Restart

- Env vars sourced from a ConfigMap or Secret do not update in a running
  container
  ([ConfigMap docs](https://kubernetes.io/docs/concepts/configuration/configmap/#configmaps-consumed-as-environment-variables-are-not-updated-automatically-and-require-a-pod-restart)).
  The agent reads its settings once through pydantic `settings`
  (`agents/sre-agent/src/config.py:20-22`), and `get_model` binds them as
  defaults (`src/clients/llm.py:14-25`).
- ESO only writes the target Secret (`refreshPolicy` `Periodic`/`OnChange`/
  `CreatedOnce`, manual `force-sync` annotation). It does not restart consumers
  ([ESO ExternalSecret API](https://external-secrets.io/latest/api/externalsecret/)).
- The chart's pod-template `checksum/config` covers only the ConfigMap
  (`templates/sre-agent/deployment.yaml:27-29`), so a Secret change never rolls
  the pod.
- **Pod-template annotation patch**: the `kubectl rollout restart` mechanism,
  and what `aectl` already does
  (`tools/aectl/cmd/sre.go:391-396`, annotation `aectl.wso2.com/restartedAt`).
  aep-api should use its own annotation key and put in a **push generation**
  (for example, the Secret's new `resourceVersion` or a hash of the pushed
  triplet). Health checks can then tell which pods run the new config. The
  permission sits with aep-api (Role above).
- **Reloader** (stakater): watches Secrets and rolls annotated Deployments. It
  removes aep-api's Deployment `patch` but adds a third-party controller that
  needs cluster-wide get/list/watch on Secrets and patch on workloads. That
  means another image to mirror, digest-pin and patch, and a much larger blast
  radius than one named `patch`. **Not recommended.**
- The Deployment name changes with the chart. AE's current patched install
  restarts `ai-rca-agent` (`tools/aectl/cmd/sre.go:235`). The v1.3.0 chart
  default is `sre-agent` (`values.yaml:1456`), so the Role's `resourceNames`
  must follow `rca.name`.

## 4. Bad key: crashloop behaviour and detection

Behaviour:

- Lifespan startup calls `get_model().ainvoke("Hello")` and raises
  `RuntimeError` on any exception (`agents/sre-agent/src/main.py:33-41`).
- The image runs `uvicorn` (`agents/sre-agent/Dockerfile:57`). uvicorn runs
  lifespan startup **before** binding sockets and calls
  `sys.exit(STARTUP_FAILURE)` when it fails, where `STARTUP_FAILURE = 3`
  ([uvicorn `server.py`](https://github.com/encode/uvicorn/blob/master/uvicorn/server.py),
  [`config.py`](https://github.com/encode/uvicorn/blob/master/uvicorn/config.py)).
- A 401 from a bad key fails in seconds, so the container exits with code 3.
  The kubelet restarts it with backoff 10s, 20s, 40s … capped at 300s and shows
  `CrashLoopBackOff`
  ([Pod lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#restart-policy)).
- An unreachable or hanging base URL may block startup longer. The openai SDK
  defaults to a 600s timeout (5s connect) and 2 retries
  ([`_constants.py`](https://github.com/openai/openai-python/blob/main/src/openai/_constants.py)).
  The socket is not bound during startup, so the liveness probe (`/health`,
  30s initial delay, 3 failures × 10s, `deployment.yaml:79-86`) kills the
  container after about 60s, and it crashloops the same way. **Unverified**:
  whether `init_chat_model` overrides these SDK defaults.
- Rollout strategy decides whether there is an outage:
  - `reportBackend: sqlite` (the default, `values.yaml:1622`) sets strategy
    `Recreate` (`deployment.yaml:20-21`). The old pod is terminated first, so
    **the SRE agent is down until a good key is pushed.**
  - `postgresql` uses `RollingUpdate`. With 1 replica, the 25% default
    `maxUnavailable` rounds down to 0, so the old pod keeps serving and the
    rollout stalls. After `progressDeadlineSeconds` (600 by default) it reports
    `Progressing=False, reason=ProgressDeadlineExceeded`
    ([Deployment docs](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#failed-deployment)).
    The old pod still loads the *new* Secret on its next restart.

How aep-api detects health:

1. **Before the push**: run the same probe against the exact key, model, and
   base URL with the existing `POST /config/llm/test`
   (`services/aep-api/internal/organization/testllm/doc.go`). Refuse to push on
   failure. This covers most bad-key cases before any outage.
2. **After the restart** (T1, same Role): poll the Deployment until
   `observedGeneration >= generation` and
   `updatedReplicas == availableReplicas == replicas`. Fail fast on Pods of the
   new template (matched by the push-generation annotation) that show
   `state.waiting.reason=CrashLoopBackOff` or `lastState.terminated.exitCode=3`.
   Surface this as agent health in the console. Never echo container logs,
   because the LLM error text can include request material.
3. `/health` (`src/main.py:135-137`, no auth) through the plane's `rcaAgentURL`
   only proves that *some* pod serves. It cannot tell which config the pod runs,
   so it cannot replace step 2.
4. On failure, the remedy is to push the previous good value again. aep-api must
   keep the last-known-good reference, not the value, in its own store to do
   this.

## Recommendation

- Choose **(c)** for T1, which is every AE install today: one pre-created
  AE-owned Secret, a Role limited by `resourceNames`, an annotation-patch
  restart, pre-validation, and status-based health.
- `aectl sre install` owns creating the Secret, the Role, and the RoleBinding.
  It knows both namespaces, and the platform chart cannot assume the OP
  namespace exists.
- Declare T2 (remote OP) out of scope for this decision. Supporting it needs
  either an OC-exposed OP secret or restart API, which would be an upstream
  change, or an AE component running in the OP cluster.
- (a) is viable but strictly larger: it needs the same Kubernetes permissions
  plus OpenBao write access and the ESO sync race.

## Security concerns (flagged, not fixed here)

1. **aep-api already holds a cluster-wide ClusterRole with Secrets
   `get, create, patch, delete`** (`deployments/helm-charts/platform/templates/aep-api/rbac.yaml:17-20`),
   plus Namespaces, ServiceAccounts, and Jobs. It can already read or overwrite
   any Secret in the cluster, including the OP namespace. A search of
   `services/aep-api` found no Kubernetes Secret or Job calls. The only raw kube
   use is the ThunderApplication LIST, so these rules look like leftovers from
   the earlier direct Job dispatch (`git log` `0e1d420e`). Audit and trim this
   before adding the narrow Role. Otherwise the Role adds nothing to least
   privilege.
2. **aep-api's OpenBao token defaults to `root`** when `AEP_OPENBAO_TOKEN` is
   unset (`tools/aectl/cmd/platform.go:238-241`), with dev-mode OpenBao locally.
   Option (a) would put the SRE key behind a root token. Any OpenBao write path
   needs a policy scoped to the path.
3. The platform `ClusterSecretStore aep-platform` authenticates with
   `openchoreo-secret-writer-role`, which has CRUD on `secret/data/*`
   (`templates/external-secrets/secret-store.yaml:1-19`,
   `deployments/single-cluster/values-openbao.yaml:53-65`). Any namespace that
   can create an ExternalSecret can read all of OpenBao through it.
4. The OP SecretStore in `sre_assets.go:40` uses OpenBao role `eso-reader`, and
   `deployments/helm-charts/design/sre-agent-install.md:44-49` says
   `aectl init` binds it. No definition of that role was found in this repo.
   Verify this in #10.
5. The upstream OP cluster-agent ClusterRole grants `secrets`, `configmaps`, and
   `namespaces` `*` cluster-wide (`templates/cluster-agent/clusterrole.yaml:38-44`).
   This is inherent to OC and should be noted in the threat model.
6. Key handling on the write: the Secret update body carries the key. aep-api's
   kube client must never log request bodies. Also check the cluster audit
   policy: `Request`/`RequestResponse` level on Secrets records values.
