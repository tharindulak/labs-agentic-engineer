# SRE agent LLM config — a platform-wide singleton

The SRE (RCA) agent runs as one shared pod, not dispatched per-org like the
coding agent or the design agent. `SreLlmConfigService` (`internal/organization/
sre_llm_config_service.go`) and its row type `PlatformSreLlmConfig`
(`internal/organization/entity_platform_sre_llm_config.go`) let an operator
point that pod at a provider, model and key of their choice from the AE
Console (Settings > Credentials > SRE agent), distinct from both:

- the org's **default Anthropic key** (`org_anthropic_credentials`, role
  `default`) — every design-agent call and the RCA agent's out-of-the-box
  wiring reads this; and
- the **coding-agent override** (`org_anthropic_credentials`, role `coding`,
  see [ADR-0016](../../../docs/decisions/ADR-0016-coding-agent-key-is-an-override-not-a-peer.md))
  — an org-scoped narrowing of the default key for one dispatched workload.

The SRE LLM config is neither: it is not org-scoped at all, and it is not an
override of an existing credential — it is a standalone platform setting with
no org dimension in its schema.

## Why a singleton, not an org-scoped credential

`org_anthropic_credentials` is keyed by `(oc_org_id, role)` because each row
answers "which org, using it how". The SRE agent has no such axis — it is one
process serving every org's alerts, so there is exactly one row,
`platform_sre_llm_config` with `id` pinned to `1`. The repository enforces
this by always targeting `id=1` rather than by a second table constraint.

## The `"platform"` sentinel org id

The secret bytes still live in the same `CredentialStore` (Postgres +
AES-256-GCM) every other credential in this package uses, because that store
requires a non-empty, validated `ocOrgID` and this config has none. `Set`/
`Clear` pass the fixed sentinel `"platform"` (`sreLlmPlatformOrgID`),
deliberately distinct from the reserved `"_platform"` used elsewhere, to key
`org_secrets[sre-llm/api-key]`. `org` and `actor` are still threaded through
`Set`/`Clear` as call parameters — not because the row or the store key needs
them, but so the audit log (`sre_llm.set` / `sre_llm.cleared`) can record who
acted on this shared resource, and so `SecretRefWriter.WriteSreLlm` has a JWT
context to compute a vault path from.

## Dual-provider validation

Unlike the Anthropic-only credential services, `SreLlmConfigService.ValidateKey`
accepts either `anthropic` or `openai` and probes the corresponding API before
persisting anything (`validateAnthropic` mirrors
`AnthropicCredentialService.validateAnthropicKey`'s probe shape; `validateOpenAI`
probes `GET /v1/models`). Error codes are namespaced `sre_llm_*` rather than
reusing the Anthropic service's `anthropic_*` codes, so a client can tell which
section rejected a key.

## Delivery: off the console's live path, through `aectl sre install`

The Console write only persists the config (row + `CredentialStore` bytes,
best-effort mirrored to SM-API/vault via `SecretRefWriter`). Getting that
config into the running SRE pod is a separate, deliberately non-live step —
one path, for both local dev and cluster installs, now that local dev also
runs on `aectl` + skaffold rather than Docker Compose
(`deployments/scripts/setup-sre.sh`'s step 4 is `aectl sre install`):

`aectl sre install`'s `--sre-llm-provider` / `--sre-llm-model` /
`--sre-llm-api-key` flags seed the key into the platform's OpenBao path
(`aep/sre-llm-api-key`), apply an `ExternalSecret` (`sre-llm-secret`, via the
`{{.PlatformSecretStore}}` `ClusterSecretStore` — the same one
`sreAgentSecretsTmpl` uses for other `aep/*` platform paths), and mount it
into the `sre-agent` Deployment as a second, optional volume
(`/etc/rca-agent/sre-llm`) alongside the required Anthropic one; when the
flags are set, `RCA_LLM_API_KEY_FILE` points at that volume instead of the
default Anthropic path, and `rca-agent-config`'s coding model is patched via
`--rca-model`. There is no console-live path: changing the config means
re-running `aectl sre install` with the (possibly updated) flags — the same
posture as every other secret this tool manages, and the same one the org's
own model-connection key follows (see [Credentials](../../../docs/developer-guide/sre-handoff-runbook.md#credentials)).
