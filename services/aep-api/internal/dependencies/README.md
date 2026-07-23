# dependencies — Dependencies & Provisioning

> **L2 · a domain.** Part of the [aep-api architecture](../../README.md).

Discover the platform-resource catalog and resource-type markers, provision the platform + external
resources a Spec declares, broker cross-project org-service access, coordinate the `aep:provision` gate,
and wire the resulting runtime config onto deployed apps. **The two halves of OpenChoreo's
`Workload.spec.dependencies[]` — resources (external / platform-resource) and endpoints (component /
org-service) — live here; provisioning drives them through the delivery funnel as an ops-class executor.**

```mermaid
flowchart LR
  API(["/api/v1"]) --> HTTP
  MCP(["/mcp"]) --> DISC
  subgraph dependencies
    HTTP["httpapi — provisioning · mcpdiscovery(resource-types)"]
    ROOT["root (kernel) — provisioner cores (external+platform) · resource-type catalog · markers · naming · endpoint catalog"]
    PROV["provisioning — aep:provision funnel lifecycle"]
    RC["runtimeconfig — SPA env-config convergence"]
    DISC["mcpdiscovery — MCP discovery server + resource-type/endpoint reads"]
    HTTP --> PROV
    HTTP --> DISC
    PROV --> ROOT
    RC --> ROOT
    DISC --> ROOT
  end
  ROOT -->|Resource/Binding CRs · resource-type discovery| OC[[OpenChoreo]]
  ROOT -->|secret values| SM[[platform/secrets · SM-API]]
  PROV -->|admit/finish/reevaluate executions| DEL[[delivery funnel]]
  PROV -->|aep:provision gate issues| SC[[sourcecontrol]]
  RC -->|design at HEAD| SPEC[[spec]]
```

## Structure — kernel-root domain
Unlike the flat-root domains (`spec`/`organization`/`projects`), `dependencies` is the kernel-root shape
`delivery` uses. The two **pure provisioner cores** — `resources` (external + platform provisioner cores,
the `ResourceTypeCatalog`, `TypeMarkers`, `ExternalResourceBindingName`/`EnvVarName` naming) and `endpoints`
(the org-service `Catalog` + `resolve`) — have no back-edges and are the shared kernel every service builds
on, so `slice → root` is the only legal direction and they **are** the root package `dependencies`. The
three services are sub-package slices that import only that root.

| Slice | Ops / role | Reaches |
|---|---|---|
| `provisioning` | 7 HTTP ops: list/delete/collect-values external resources, provision-platform, dependency-status, request/list org-service access + the aep:provision funnel lifecycle, watcher, teardown | root cores; delivery funnel (executions); sourcecontrol (gate issues) |
| `mcpdiscovery` | the MCP discovery server + `ListPlatformResourceTypes` HTTP read | root `ResourceTypeLister` / endpoint catalog |
| `runtimeconfig` | the SPA `env-config.js` convergence service + its watcher (no HTTP op) | root naming/markers; spec (design at HEAD); repositories (execution enumerate) |

Each slice owns its service AND its HTTP handler (as delivery's `build` slice does); `httpapi` aggregates
the two handler-bearing slices and **holds `Deps`** — the kernel-root consequence that the root may not name
its own sub-package services (`root ⊥ slice`), so assembly lives in the one package allowed to import the
slices.

## Ports
| Port | Dir | Peer · contract |
|---|---|---|
| SecretWriter | needs | `platform/secrets` — SM-API vault writes for external-resource secret values |
| OC `Resource`/`ResourceReleaseBinding` CRUD · `ClusterResourceType` discovery | needs | `openchoreo` client — OC is the store |
| ExecutionStore · Reevaluator (admit/finish/reevaluate) | needs | `delivery` — provisioning is the **ops-class executor**, satisfied through delivery's execution funnel |
| IssueClient (aep:provision gate) | needs | `sourcecontrol` — gate issues, closed via a no-secrets reference |
| DesignReader / DesignBundleReader | needs | `spec` — design at HEAD (what to provision) + provider design bundles |
| the 8 public ops | offers | the edge (`dependenciesHandlers`) |

## Owns
- `ExternalResource` (an in-memory definition, NOT a DB row — see Persistence), `AccessRequest`, the
  authored OC external Resource model + provisioned binding values, the `aep:provision` gate issues
  (via `sourcecontrol`), and the resource-type catalog projection.
- **Persistence**: only `AccessRequest` is persisted (`repository_access_request.go` over
  `access_request.go`), single write-authority. `ExternalResource` is an in-memory definition, not a
  DB row — the org-namespaced OpenChoreo `ResourceType` is the registry (ADR-0009).

## Invariants — don't break
- **Secret values never leave the SecretWriter port.** External-resource secret values route through SM-API;
  issue bodies, comments, and API responses carry only names / paths / refs — never secret material. The
  domain imports no secret-backend SDK (the fence holds via `platform/secrets`).
- **Provisioning is an ops-class Executor**, not a table split: it drives the executions rows through the
  delivery funnel's admit/finish/reevaluate, so the funnel invariant (one dispatch path, gates unbypassable)
  is preserved even though provisioning is a separate domain.
- **The wire quirks the contract-first cutover pinned stay pinned**: wrong-kind → 400, not-found/
  not-registered → 404, in-use → 409, provision-failure → 502; get-dependency-status and list-access-requests
  return their empty-but-present shapes; a nil service 503s (the surface exists with the feature unwired).
- Platform-wide rules (tenant gate, secrets fence, feature-free domains) → [../../README.md](../../README.md).
