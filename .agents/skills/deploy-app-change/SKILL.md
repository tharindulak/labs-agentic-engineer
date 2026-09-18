---
name: deploy-app-change
description: Build a hand-made change to an AE-generated project app and get it running on the local k3d cluster, without a delivery run. Use when a change must reach the cluster outside the normal spec-driven loop - seeding a demo defect, testing a fix by hand, or unblocking a demo whose run is terminal.
disable-model-invocation: true
---

# Deploy a hand-made app change

AEP deploys **only inside a run's deploy stage**. `DeploymentService.deployOne`
(`services/aep-api/internal/projects/deployment_service.go`) is reached from one
place — `run/activities.go`'s deploy pass. Nothing else cuts a release:

| What you might reach for | What it actually does |
|---|---|
| `POST /projects/{p}/components/{c}/builds` | builds at HEAD, posts a Workload, **cuts no Release** |
| `POST /projects/{p}/builds/{tag}/revalidate` | validates *"against the system already deployed"* — never builds |
| pushing to `main` | nothing; there is no push-webhook handler |
| `Converge` | re-asserts bindings at the **current** release; deliberately cannot promote |

So a hand-made commit needs the three writes the deploy stage would have made.
This skill is those three writes. Everything here was measured on a live k3d
cluster, not derived from the manifests.

**Do not use this for normal delivery.** It bypasses the run, so nothing records
the deploy: no `milestone_runs` row moves, no validation fires, no build ledger
entry. The cluster ends up ahead of what the platform believes is deployed. That
is acceptable for a demo or a diagnosis and wrong for anything else.

## 0. Gather the facts

Every later step derives from these. Read them; do not assume them.

```bash
PROJECT=<aep project slug>            # e.g. service2-serves-fixed-neww
COMPONENT=<short component name>      # e.g. service1  (NOT the OC-prefixed name)
OC_COMPONENT="$PROJECT-$COMPONENT"

# The dataplane namespace is generated; find it rather than construct it.
NS=$(kubectl get ns -o name | sed 's|namespace/||' | grep "^dp-.*development" | head -1)

# The three objects the deploy stage writes/reads, all in `default`:
kubectl -n default get workload.openchoreo.dev "$OC_COMPONENT-workload" -o yaml
kubectl -n default get componentrelease.openchoreo.dev -l "openchoreo.dev/component=$OC_COMPONENT"
kubectl -n default get releasebinding.openchoreo.dev "$OC_COMPONENT-development" -o yaml
```

Record the **current** release name — it is your rollback:

```bash
OLD_RELEASE=$(kubectl -n default get releasebinding.openchoreo.dev \
  "$OC_COMPONENT-development" -o jsonpath='{.spec.releaseName}')
```

## 1. Prove the change locally first

A cluster build takes ~4 minutes and a compile error costs all of it. The repo
ships the Dockerfile the platform uses, so build the real artifact:

```bash
cd <repo>/$COMPONENT && docker build -t verify:local .
```

Run it against its siblings on a throwaway docker network and confirm the
behaviour you intend. If the project has `tests/e2e`, point the committed specs
at your container instead of the cluster — the env var wins over `targets.json`:

```bash
AEP_E2E_TARGET_<COMPONENT_UPPER>=http://localhost:<port> npx playwright test
```

Run it **before** pushing. `targets.json` points at the deployed gateway, so a
bare `npx playwright test` silently tests the cluster, not your build.

## 2. Push the commit

```bash
git push origin main && SHA=$(git rev-parse HEAD) && SHORT=${SHA:0:8}
```

**It must be on `main`** if a coding agent will later work from it — the SRE loop
branches from `main`, so a defect parked on a side branch leaves the agent
nothing to find.

## 3. Build it with the platform's own builder

Do not hand-build and push to the registry. Re-issue the `WorkflowRun` the
platform uses, so the image is produced and tagged exactly as a real build would
be. Copy the component's last run and change two things: the **commit** and the
**image tag** in the `workload` annotation.

```bash
REGISTRY=registry.openchoreo-workflow-plane.svc.cluster.local:10082
IMG="$REGISTRY/default-$PROJECT-$OC_COMPONENT:v1-$SHORT"      # tag == v1-<sha[:8]>
```

The previous run is the easiest template, but **it is usually gone**:
`WorkflowRun`s carry `ttlAfterCompletion: 1d`, so on any component built more
than a day ago there is nothing to copy.

```bash
kubectl -n default get workflowrun.openchoreo.dev \
  -l "openchoreo.dev/component=$OC_COMPONENT" -o yaml     # often 0 items
```

When it is gone, build the run from the **Component CR**, which is where the
platform itself reads it (`componentClient.triggerBuildInner` →
`buildWorkflowFromComponent`). It carries the workflow kind/name and the
`docker.context`, `docker.filePath` and `repository.appPath`/`url` parameters:

```bash
kubectl -n default get component.openchoreo.dev "$OC_COMPONENT" -o jsonpath='{.spec.workflow}'
```

Then a `WorkflowRun` is that workflow plus three things the Component does not
carry: `spec.workflow.parameters.repository.revision.commit: $SHA`, the
`openchoreo.dev/workload` annotation holding the Workload CR JSON with `$IMG`
in `spec.container.image`, and `openchoreo.dev/workload-from-source: "true"` —
that annotation is what makes the finished workflow update the Workload CR.

**A private repo needs a build credential, and none is lying around.** The
platform stages a per-run Secret (`CodingExecutor.stageBuildSecret` →
`StageBuildSecret(orgID, repoSlug, runName)`) and the run's `secretRef` names
it; it is deleted afterwards, so `kubectl get secret` finds nothing to reuse.
An unauthenticated clone is correct only for a public repo.

### When you cannot stage the credential

Two escapes, in order of preference.

**The console's Build button** — `POST /projects/{p}/components/{c}/builds`.
It stages the secret and builds at HEAD for you, and since it posts a Workload
but cuts no Release, steps 4 and 5 below still supply the rest. It needs an
org-scoped JWT; from a browser session that is free, from a shell it is not
(`401 missing Authorization header`).

**Push the image yourself.** Slower to justify but fully local: the in-cluster
registry is published on the host at `localhost:10082`, so a locally built
image can be pushed under the exact tag a real build would produce.

```bash
docker build --platform linux/arm64 --provenance=false --sbom=false \
  -t "localhost:10082/default-$PROJECT-$OC_COMPONENT:v1-$SHORT" .
docker push "localhost:10082/default-$PROJECT-$OC_COMPONENT:v1-$SHORT"
curl -s "http://localhost:10082/v2/default-$PROJECT-$OC_COMPONENT/tags/list"
```

Match `--platform` to the nodes (`kubectl get nodes -o jsonpath=…architecture`);
a host-arch image on arm64 nodes rolls green and then crash-loops.
`--provenance=false --sbom=false` keeps buildx from pushing a manifest list the
node's containerd will not resolve. This skips the build ledger the platform
build would write, on top of the run bypass this whole skill already accepts —
and because no workflow ran, **the Workload CR is not updated for you**; patch
`spec.container.image` yourself so the next release derives from the right image.

Apply a copy with a new `metadata.name`, `…revision.commit: $SHA`, and the new
`$IMG` inside the `openchoreo.dev/workload` annotation. Keep
`openchoreo.dev/workload-from-source: "true"` — that is what makes the workflow
update the Workload CR when it finishes.

Wait for it, then **verify the Workload actually moved**:

```bash
kubectl -n default get workload.openchoreo.dev "$OC_COMPONENT-workload" \
  -o jsonpath='{.spec.container.image}'
```

## 4. Cut the ComponentRelease

`ComponentRelease` **snapshots** the image into `spec.workload.container.image`.
Updating the Workload alone deploys nothing — this is the step people miss.

Derive the new release from the existing one rather than authoring it: it also
carries `spec.componentProfile.traits`, which is where the auto-provisioned
`*-auto-rca-error` alert rule lives. Author one by hand and you silently drop it.

```bash
kubectl -n default get componentrelease.openchoreo.dev "$OLD_RELEASE" -o json > /tmp/cr.json
# then: drop .status and metadata{resourceVersion,uid,creationTimestamp,
#       generation,managedFields,ownerReferences,finalizers};
#       set .metadata.name = <new>; set .spec.workload.container.image = $IMG
kubectl apply -f /tmp/cr-new.json
```

The platform names these `ReleaseNameFor(project[:18], component[:18], sha[:12])`
plus a bound hash. Yours only has to be unique and a valid k8s name — include the
short SHA so the release can be matched to its commit later.

Confirm the traits survived:

```bash
kubectl -n default get componentrelease.openchoreo.dev "$NEW_RELEASE" \
  -o jsonpath='{.spec.componentProfile.traits[*].instanceName}'
```

## 5. Repoint the binding — merge-patch only

```bash
kubectl -n default patch releasebinding.openchoreo.dev "$OC_COMPONENT-development" \
  --type=merge -p "{\"spec\":{\"releaseName\":\"$NEW_RELEASE\"}}"
```

**Patch `spec.releaseName` and nothing else.** The binding carries
`spec.traitEnvironmentConfigs`, which holds the alert rule's `triggerAiRca: true`.
Replace the whole object, or re-author it, and the rendered
`ObservabilityAlertRule` loses `triggerAiRca` — the rule still fires and the RCA
never runs, with nothing in any log saying why. Always re-read it after patching:

```bash
kubectl -n default get releasebinding.openchoreo.dev "$OC_COMPONENT-development" \
  -o jsonpath='{.spec.traitEnvironmentConfigs}'
kubectl -n "$NS" get observabilityalertrules \
  -o jsonpath='{range .items[*]}{.metadata.name}{" triggerAiRca="}{.spec.actions.incident.triggerAiRca}{"\n"}{end}'
```

## 6. Verify on the cluster, not in the manifest

The rollout is usually a few seconds. Prove all three:

```bash
kubectl -n "$NS" get deploy "$OC_COMPONENT" \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"  ready="}{.status.readyReplicas}'
```

1. the Deployment's image tag is `v1-$SHORT`
2. `readyReplicas` is 1
3. the endpoint's **behaviour** changed — call it, and read the pod log

A green rollout of the wrong image is the most common false positive here.

## Rollback

One patch, because step 5 changed one field:

```bash
kubectl -n default patch releasebinding.openchoreo.dev "$OC_COMPONENT-development" \
  --type=merge -p "{\"spec\":{\"releaseName\":\"$OLD_RELEASE\"}}"
```

The old ComponentRelease is untouched, so this is immediate and total. Leave the
new release in place; it costs nothing and documents what was tried.

## If the point was to fire the SRE loop

Deploying the defect is half of it. The rest is wired outside this skill and is
worth checking before concluding the loop is broken — the detection path fails
silently in three separate places:

- **The rule matches a raw substring `error` in the log line, with no severity
  filter.** A failure logged at WARN, or swallowed by a generated
  `ResponseErrorInterceptor`, fires nothing.
- **The OpenSearch alerting monitor throttles its action for 60 minutes**, and
  the observer applies `ALERT_SUPPRESSION_WINDOW=1h`. But throttle is tracked
  **per alert** — once an alert goes `COMPLETED` (its window passes with no new
  errors), the next burst opens a *new* alert and notifies immediately. Check
  alert state before assuming you must wait.
- **The RCA agent needs a working Anthropic key.** `POST /analyze → 200 OK`
  followed by `AnthropicAuthenticationError: 401` means detection worked and only
  the model call failed; no report reaches `rca_agent_reports` and no issue is
  filed. Note the observability plane's `rca-agent-anthropic-secret`
  ExternalSecret resolves by `find` across `user-app-secrets/` and **concatenates
  every match** — two workspace paths for one org yields a doubled, invalid key
  while AEP's own key validation still passes. See
  `deployments/scripts/setup-observability.sh`.
