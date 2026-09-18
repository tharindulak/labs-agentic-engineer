# ADR-0024 — Advertised is not reachable

OpenChoreo advertises a binding's external URLs from the endpoint's **shape**,
not from what its gateway serves. A plane whose gateway does not terminate TLS
therefore advertises an https URL beside the http one, and only the http one
answers:

```json
"externalURLs": {
  "http":  { "port": 19080, "scheme": "http"  },   // the only listener
  "https": { "port": 19443, "scheme": "https" }    // advertised, never served
}
```

That was survivable while the URL only became a console link. It stopped being
survivable when the runner gained a reachability gate, which probes the deployed
endpoints before starting the agent and refuses to run when they do not answer.
An advertised-but-dead URL then blocks **validation** rather than merely
rendering a bad link — every project in the local cluster failed with:

```
endpoint_unreachable: service1 (https://…:19443/…): aborted due to timeout
[oneshot] deployed endpoint(s) did not answer — not starting the agent
```

k3d publishes 19443 at the Docker level, so the TCP connect succeeds and the
failure surfaces as a timeout or `SSL_ERROR_SYSCALL` rather than a clean refusal.

## Decision

**Two mechanisms, at different levels, and the first one is the answer.**

**1 — The platform states which scheme the plane serves.**
`Config.PreferPlainHTTPEndpoints` selects the http external URL when a binding
advertises both, and it is set at the composition root from
`PlatformAPI.DataPlaneGatewayTLS` — the stated fact about the plane, never the
deployment tier, which would mirror the same bug onto a dev-tier plane that does
terminate TLS. This is what makes `EndpointURL` correct for every consumer at
once: the console link, and validation.

**2 — The preflight verifies rather than assumes.**
`PublicEndpointURLs` returns every advertised URL, the validation context carries
them as `urls[]` beside the preferred `url`, and the runner's preflight tries each
and adopts the first that answers, rewriting the context file so the agent curls a
URL proven to respond. Only if none answer is the endpoint reported unreachable.

The second is defence in depth, not the fix. With the flag set correctly the
preferred URL answers first and the extra candidates are never dialled.

## Why both, and the honest tension

The repository generally prefers one mechanism over two — a second copy of a
decision is how the copies drift, and a hidden copy is how one silently wins. The
case for keeping the preflight's candidates is narrow: the config is a *claim*
about the plane, and if it is wrong (a plane reconfigured without the flag being
updated) it fails as a blocked validation with a misleading "endpoint unreachable"
rather than as an obviously wrong setting. Probing turns that into a self-correction.

The case against is that it re-derives at runtime what the plane already states,
and adds an internal-contract field, a client method and an interface method to do
it. If the flag proves reliable, the candidate list is the part to remove.

## Consequences

- **The rule that must not be "unified":** the console's single-URL pick and the
  preflight's candidate list answer different questions — "what should a human
  click" and "what will answer". They now sit side by side in one file, and
  collapsing them would reintroduce the original bug.
- **An unreachable endpoint still blocks validation, correctly.** If the gateway
  serves neither scheme, no amount of candidate-probing helps and the run refuses
  to start. This ADR removes a wrong choice; it does not paper over a broken plane.
- **The context file is rewritten after probing** by patching the parsed payload's
  `url` values, not by re-serialising from the runner's model — the file is
  written verbatim so a field the runner does not model still reaches the skill.
