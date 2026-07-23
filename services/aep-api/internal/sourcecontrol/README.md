# sourcecontrol — Source Control & Webhooks

> **L2 · a domain.** Part of the [aep-api architecture](../../README.md).

The git-host integration substrate every other domain builds on: per-project repo/issue/PR/webhook
lifecycle over a provider-neutral `Host` port, and the bare-mirror workspace behind `platform/gitfs`.

```mermaid
flowchart LR
  API(["/api/v1"]) --> SL
  subgraph sourcecontrol
    SL["slices — issues"]
    CORE["repo · issue · workspace core"]
    GH["githubhost<br/>(the Host adapter)"]
    SL --> CORE
    CORE --> GH
    CORE --> DB[("git_repositories")]
  end
  GH -->|REST| GITHUB(["GitHub"])
  CORE -->|Credential| SEC[[platform/secrets]]
  CORE -->|mirrors| GITFS[[platform/gitfs]]
```

## Slices
| Slice | Use-case | Entry |
|---|---|---|
| `issues` | file / search a project's issues | `POST`+`GET /projects/{projectName}/issues` |

*Still in the domain root (not carved into slices): repo lifecycle, workspace, webhook register/receive,
and installation lifecycle.*

## Ports
| Port | Dir | Peer · contract |
|---|---|---|
| `Host` | needs | the git host — implemented by `githubhost` (the domain's own adapter; it lives here, not in `platform/clients`, because an adapter for a domain's port cannot sit in a domain-free kernel) |
| `secrets.Credential` | needs | `platform/secrets` — App-installation / per-org PAT |
| `IssueService`, `RepoService` | offers | every domain that needs repos or issues |

## Owns
- `git_repositories` (the repo coordinate registry) and `webhook_deliveries` — gorm + entities in this
  domain (`repository_repo.go` · `repository_webhook_delivery.go` over `repository_entity.go` /
  `webhook_delivery.go`), single write-authority. `GitRepository` is not `x-go-type`-aliased, so it needs
  no wire split.
- The bare-mirror workspace handle, and the GitHub host connection state.

## Invariants — don't break
- **`Host` is provider-neutral.** GitHub specifics live in `githubhost`; nothing above it names GitHub.
- Ports here are **nil-tolerant**: an unwired service answers 503, never panics — the component harness
  wires only the feature under test, and `edge`'s `sourceControlOrEmpty` preserves that for an unwired
  domain.
- `IssueInfo`'s wire keys are **CAPITALIZED** — a historical shape the deployed MCP server parses.
- Platform-wide rules (tenant gate, secrets fence) → [../../README.md](../../README.md).
