---
name: high-level-architecture
description: Use when turning requirements into a design — creating or restructuring specs/design/design.md, deciding which components the system decomposes into, writing the specs/design/design.cell architecture diagram, or writing a component's design.json.
metadata:
  aep:
    kind: platform
---


# High-level architecture

Derive the design tree from `requirements.md`. The design lives under
`specs/design/` — never at the bundle root.

```
specs/design/design.cell                      # project-level architecture diagram DSL (this skill) — emit FIRST
specs/design/design.md                        # the top-level design (this skill)
specs/design/components/<name>/design.json    # one per component (structured facts)
specs/design/components/<name>/wireframes.dsl  # web-applications only (excalidraw-wireframes skill)
specs/design/components/<name>/openapi.yaml   # services only (openapi-conventions skill) — emit LAST
```

## The architecture diagram — design.cell

`specs/design/design.cell` is a single project-level file holding the
cell-diagram DSL. Emit it **FIRST**, before design.md and the component
design.json files: it is small, it fixes the component decomposition up front,
and the console streams it into the live architecture diagram as you write, so
the user watches the architecture take shape.

**Load the `cell-architecture-dsl` skill before writing design.cell.** It
carries the full grammar, the AEP boundary semantics (own components inside the
cell; Thunder auth and org services on east; third-party SaaS on south;
internet/intranet exposure on north/west), and the single-`addFile` write
protocol. Do not guess the syntax — `resource`/`external` are NOT keywords, and
the node `type` is a bare trailing token with no colon.

**design.cell is the architecture contract.** The rest of the design must match
it: every `components/<name>/design.json` uses the SAME component id as its
`design.cell` node, and every edge in design.cell that touches a component
appears as a `dependencies[]` entry on that component's design.json (and vice
versa — an interaction in design.json must be an edge in design.cell). A
mismatch between the two is a defect, not a stylistic choice.

## Incremental architecture changes

When a later change alters the ARCHITECTURE of an existing design — a component
added/removed/renamed, an edge or exposure changed, an external/SaaS dependency
added or dropped — keep the generation order: update
`specs/design/design.cell` FIRST (load `cell-architecture-dsl`; targeted
editFile edits, or removeFile + ONE addFile only for a restructure), then the
design.md Components/Interactions sections, then every affected component's
design.json. design.cell stays the architecture contract after every change,
not just the first one. A change that alters none of those leaves design.cell
untouched.

## The top-level design.md

These sections, in order. Depth rule: **every requirement must have a home** in
a capability, entity, role, or screen below — a requirement you can't point to
in this document is a defect, not an editing choice.

1. **Overview** — what the system is, in one paragraph.
2. **Components** — a bullet per component: name, `type`, one-line
   responsibility.
3. **Capabilities** — per component, the exhaustive feature list the
   requirements imply, each with 1–2 sentences of responsibility. Group by
   module when the requirements do (e.g. "Risk register", "Audit evidence").
   This list drives the component's API resources and screens — anything
   missing here silently disappears downstream.
4. **Data model** — the core entities, their key fields, and relationships.
   These become the API's `components/schemas`.
5. **Roles & access** — the actors from the requirements and what each may
   see/do. Drives auth design and per-role screens.
6. **Interactions** — who calls whom and for what: component-to-component
   plus external integrations (email, AI/LLM, object storage, ...).
7. **Data flow** — the main lifecycles end to end (one numbered walkthrough
   per core workflow).

Do NOT add platform-owned boilerplate: no Kubernetes/monitoring/backup
sections, no generic performance targets, no "future enhancements" — unless
the requirements state them.

After emitting or changing a component's design, record the skills that
component's build actually needs as a `skillsApplied` array **inside that
component's `specs/design/components/<name>/design.json`** — e.g. a Go API
service → `["openapi-conventions", "go"]`; a web-application →
`["excalidraw", "react"]`. It is a JSON key on the component's design object,
so include it when you write that `design.json` (addFile/editFile) — do NOT
put `skillsApplied` in `design.md` frontmatter. Each component carries only the
skills its own build needs.

## Deriving components — deployment units the requirements justify

A component is one independently deployable unit, NOT a domain concept. The
right number comes from the requirements: for every component you must be
able to say "this deploys and evolves independently because <something the
requirements state>". Write that justification into the component's
`description`.

A requirement justifies a SEPARATE component when it shows:

- a distinct user-facing surface — e.g. an internal admin portal AND a
  customer-facing app with different users and lifecycles → two web-applications;
- a genuinely different runtime or scaling profile — e.g. an async
  worker/batch processor beside an interactive API, or a long-running
  AI/inference service;
- a technology the rest of the system doesn't share — e.g. a Python ML
  service beside a Go API;
- an explicitly separate lifecycle or ownership stated in the requirements.

Do NOT split by:

- entity or domain concept — claims-service, users-service,
  receipts-service... is a domain model dressed as a topology; those are
  modules of ONE service;
- layer — auth, notifications, file storage as own services when they are
  modules of the API;
- infrastructure — api-gateway, database, queue, auth server are NEVER
  components; the platform provides them.

When nothing above forces a split, a small system naturally lands at one
service + one web-application — that is an outcome of the rule, not a target. Name
components in kebab-case after their responsibility (`expense-api`,
`expense-webapp`, `report-worker`).

**Component `type` is a fixed vocabulary — use the EXACT string.** A backend is
`"service"`; a browser app is `"web-application"` (OpenChoreo's own term). Write
`"web-application"` verbatim — NOT `"webapp"`, `"web-app"`, or `"webApplication"`
(those are rejected, and a wrong value silently breaks the app's deployment and
runtime config). The `-webapp` in a component NAME is fine; the `type` is still
`"web-application"`. Other kinds the requirements imply (`"scheduled-task"`,
`"worker"`, …) are captured verbatim.

## Per-component design.json

Each component's structured facts live in ONE JSON document (no markdown, no
frontmatter). The platform validates each write against this schema and rejects
violations:

```json
{
  "name": "expense-api",              // MUST equal the directory name
  "type": "service",                  // EXACT kind: "service" or "web-application" (NEVER "webapp"/"web-app"), or another the requirements imply ("scheduled-task", "worker", ...)
  "version": "0.1.0",                 // semantic version; 0.1.0 for a new component
  "language": "Go",                   // implementation language, e.g. "Go", "TypeScript"
  "buildpack": "docker",              // always "docker"
  "appPath": "expense-api",           // repo-relative source dir — the component name
  "entrypoint": "deployment/service", // deploy entry
  "exposure": "internet",             // "internet" (public) | "intranet" (internal only)
  "dependencies": [ /* see below — every arrow in Interactions appears here */ ],
  "description": "One paragraph: single responsibility, port/entrypoint expectations, and what it explicitly does NOT do.",
  "endpoint": { "name": "http" } // optional; see below
}
```

`name`, `type`, `version`, `language`, `buildpack`, `appPath`, `entrypoint`,
`exposure`, `description`, and `dependencies` are required. To CHANGE a
design.json, re-emit the whole corrected file (removeFile + addFile) — never
patch JSON with anchored edits. On INVALID_JSON or SCHEMA_VIOLATION, fix what
the message lists and re-emit.

`endpoint` is optional: omit it and a service's endpoint takes the default name
`"http"`. Declare `{ "name": "<endpoint-name>" }` only when the endpoint must be
named otherwise — `name` is the single source of truth the coding agent copies
into `workload.yaml` and the managed-API gateway binds to. The port lives in
`workload.yaml`, not here.

Do NOT author `exposesAPI`, `componentAgentInstructions`, or any dependency
`status`/`reason` — those are PLATFORM-owned. If the platform has already
written them into the file, preserve them verbatim.

### dependencies — the unified dependency edges

`dependencies` mirrors the Interactions section of the top-level design.md:
every arrow there appears here and vice versa — a mismatch is a defect. Each
entry has a `kind` (which selects the meaningful fields) and a `name`; pick the
kind by WHAT the target is:

- **`component`** — a SIBLING component in this same design that THIS component
  CALLS: a directed caller→callee edge (one Interactions arrow). Declare it ONLY
  on the caller, naming the callee it invokes:
  `{ "kind": "component", "name": "expense-api" }`. Never add the reverse edge —
  a web-app depends on the API it calls; the API does NOT depend on the web-app
  that calls it. If a component isn't actually called by this one, it is not a
  dependency of it (do not list it "for reference").
- **`org-service`** — a service owned by ANOTHER project in the org that
  publishes its endpoint for cross-project use. Its `name` is the provider's
  EXACT component name from `list_org_endpoints`, copied verbatim — a name you
  LOOK UP, never one you coin. The requirement (and any org skill) names the
  service by ROLE ("the organization's directory service", "the notification
  service"); that role is NOT the name, and the provider is usually named
  differently — the "directory service" may be `employee-service`, the
  "notification service" `email-service`. Call `list_org_endpoints`, pick the
  row that fills the role, copy its `name`:
  `{ "kind": "org-service", "name": "<name from list_org_endpoints>" }`. A name
  coined from the role words matches no provider and hard-fails the build.
- **`external`** — a system OUTSIDE the platform (a SaaS API, a legacy
  service). Classify it into one of two styles — see "Resolving an `external`
  dependency" below for the full discovery procedure:
  - **`style: "rest-api"`** — the component calls specific HTTP endpoints.
    Needs an OpenAPI contract at `specPath`, which is EITHER a URL (a public
    spec/docs URL you discovered) OR a repo-relative path to a user-provided
    spec file (`dependencies/<name>.openapi.yaml`). The coding agent reads
    whichever it is — fetching the URL or the file — and researches the API
    beyond it as needed.
  - **`style: "sdk"`** — the component codes against a vendor SDK/library.
    Declare `package`, one ecosystem-prefixed identifier
    (`npm:stripe@^14`, `go:...`, `pypi:...`).

  `style`, `package`, `specPath`, and `candidates` are
  meaningful ONLY on `kind: "external"` — declaring any of them on a
  `component`/`org-service`/`platform-resource` dependency is a schema
  violation (the zod write-gate and the Go fold gate both reject it).
- **`platform-resource`** — a backing resource the platform provisions (a
  database, cache, object store). Set `resourceType` to a registered type and
  `parameters` for provisioning:
  `{ "kind": "platform-resource", "name": "orders-db", "resourceType": "postgres", "parameters": { "size": "small" } }`.
  `thunder-app` is the platform's auth resource type: when the spec implies
  users sign in, declare it on BOTH the SPA and each protected service, using
  the SAME dependency `name`. For `thunder-app` ONLY, proposing the `scopes`
  parameter value is allowed (default `openid profile email`); every other
  resource type keeps the no-invented-parameters rule. Never propose
  `redirectUris` — they are platform-managed. See the `thunder-authentication`
  skill for the full rule.

```json
"dependencies": [
  { "kind": "component", "name": "expense-api" },
  { "kind": "platform-resource", "name": "orders-db", "resourceType": "postgres" },
  { "kind": "external", "name": "stripe", "style": "sdk", "package": "npm:stripe@^14",
    "config": [ { "key": "STRIPE_API_KEY", "secret": true, "description": "Your Stripe secret API key" } ] },
  { "kind": "external", "name": "github", "style": "rest-api",
    "description": "GitHub REST API for issues + PRs." }
]
```

The `github` entry above is unresolved on purpose: `style: "rest-api"` with no
`specPath` yet computes `unresolved`/`needs-spec` — expected, not an error to
fix (see "Resolving an `external` dependency" below for how it gets a
`specPath`).

**Discover before you invent.** The platform MCP tools are the source of truth
for every dependency's name and shape — call them before authoring an
`external`, `org-service`, or `platform-resource` dependency, and take the name
and schema from what they return, not from the requirement's wording:

- `list_external_resources` / `get_external_resource_schema` — read each
  registered resource's `name` AND `description`, and reuse the one whose
  description fits the need, adopting its EXACT `name` + `config` schema rather
  than inventing a parallel one. The description is the match signal: a
  registered resource described as "transactional email delivery" is the right
  reuse for an "email" need even when its name (say `sendgrid`) doesn't echo the
  requirement's wording. Only when no registered resource fits do you move on to
  discovering a new one (`web_search`) — see "Resolving an `external`
  dependency" below.
- `list_org_endpoints` — the org-service catalog every `org-service` `name` is
  copied from verbatim (see the `org-service` kind above). When no row fills the
  role the requirement describes, leave the dependency unresolved rather than
  coining a name — a name that resolves to nothing is worse than an absent one.
- `list_org_component_endpoints` — once you have the provider's name, call this
  to read its REAL contract before writing the dependency's `description`:
  each row resolves to a `spec.availability` of `inline` (read
  `spec.inlineContent` directly — it IS the OpenAPI document), `repo` (no
  inline spec, but the row's `owner`/`repo`/`subdir`/`branch` locate the
  provider's source — use `search_remote_git_code` under that `subdir` to find
  the spec file if you don't know its exact path, then
  `get_remote_git_file_contents` to read it), or `none` (no contract is
  resolvable). Base the dependency's `description` on the ACTUAL
  operations/paths/schemas the contract exposes; on `none`, say so plainly in
  the `description` instead of inventing a shape.
- `list_platform_resource_types` — get a valid `resourceType` (and its
  parameters) before declaring a `platform-resource`. Read each type's `name`
  AND `description` and pick the type whose description matches the need; when
  none matches, leave the dependency unresolved rather than forcing a fit.

**Narrate each dependency decision in chat as you make it.** The
design-generate turn runs in the chat panel, so your turn text is what the
user watches live. As you settle each dependency — `component`, `org-service`,
`platform-resource`, or `external` alike — say it in one concise plain-prose
line before moving to the next:

- resolved → `✓ <capability>: using <choice>`
- candidates → `<capability>: options are A / B / C — tell me which (I'll
  continue meanwhile)`
- needs-input → `<capability>: I couldn't identify the system — tell me which
  + how it authenticates`

Never block the design on an ambiguous or unresolved dependency — print the
line and keep emitting the rest; the user replies in the same chat to steer or
resolve it, now or later (see "Resolving or reconsidering a named dependency"
below).

**Close with a scannable summary, not a recap.** When the design is complete,
end the turn with three parts and nothing more: (1) one line per component —
name, type, one-clause role; (2) a **"Needs your input"** block listing ONLY
the dependencies still ambiguous or unresolved, each with the single thing you
need from the user; (3) a one-line pointer to `specs/design/`. The
per-dependency narration above already carried the play-by-play, so the
closing summary stays short and the user's next action is unmissable — a
file-by-file recap buries it.

### Resolving an `external` dependency

`external` is the one kind with real-world discovery to do — the SaaS or
legacy system doesn't live in any catalog you can look up directly. Work it as
a procedure, in order:

1. **Reuse first.** `list_external_resources` / `get_external_resource_schema`
   (above) — scan the registered resources by `name` AND `description`, and
   when one's description fits the need, author the dependency under that
   resource's EXACT registered `name`: it then resolves from the registry
   regardless of `style`/`specPath`/`package`. A resource whose description
   fits is the right reuse even when its name doesn't echo the requirement's
   wording. Don't re-discover what the org already has.
2. **`web_search` for candidates** when nothing registered fits. Stop at the
   options actually worth presenting to step 6 below — a single option only
   when a real signal already points to it; just as often, the search
   legitimately turns up 2–3 genuine contenders to hand the user as
   `candidates`.
3. **Classify each candidate's style.** `rest-api` when the component talks to
   specific HTTP endpoints; `sdk` when it codes against a vendor SDK/library —
   the candidate's own docs make this obvious ("REST API reference" vs.
   "install our SDK").
4. **Resolve the contract.**
   - `rest-api` needs a `specPath` — a public spec/docs URL, or a repo-relative
     path to a stored spec file. Prefer a URL you discovered: confirm it's a
     real OpenAPI document with `fetch_openapi_spec` (it fetches + validates;
     stores nothing), then set `specPath` to that URL — the coding agent fetches
     it at build time and researches the API further. If the user hands you a
     spec file (or the API is private/undocumented), `addFile` it to
     `specs/design/components/<component>/dependencies/<dep-name>.openapi.yaml`
     and set `specPath` to that repo-relative path. Either way the dep resolves;
     with NO `specPath` at all it stays `needs-spec` and the build gate asks the
     user to supply one. Don't hand-author a whole spec — the coding agent
     researches the API; only store a file when the user provides one or the
     contract isn't publicly discoverable.
   - `sdk` needs `package`: one ecosystem-prefixed identifier (`npm:`, `go:`,
     `pypi:`), version inline but optional (`npm:resend` with no version ⇒ the
     coding agent picks the latest compatible).
5. **Derive `config` keys** from the contract: a `rest-api`'s
   `components.securitySchemes`, or an `sdk`'s auth documentation (API key,
   client id/secret, ...). See "Config-key conventions" below for the key
   format.
6. **Emit the outcome** — never a `status`/`reason`, only the fields the
   platform derives one from:
   - **A real SIGNAL points to one option → it clearly wins ON THAT SIGNAL →
     emit it resolved.** A signal is one of: the requirement names or implies
     the vendor, an already-registered external resource fits (registry
     reuse), an org or platform skill mandates it, or a concrete technical
     reason forces it (must match an existing stack/format). Emit `style` +
     (`package` or `specPath`) and `config`. A
     preference with no such signal behind it — "this one is popular" or
     "this is what I'd pick" — is not a signal; it's a guess dressed as a
     resolution, and it belongs in `candidates` instead.
   - **No signal, and 2+ viable equivalents exist → emit `candidates`.** This
     is the EXPECTED outcome for a genuinely-choosable dependency (e.g.
     transactional email: SendGrid/Resend/Postmark) — do not force a pick the
     requirements don't justify. `candidates` needs 2 or more entries — never
     one: one option fully known resolves outright, one option only partially
     known is a partial dep, not a candidate, so leave `style` and whatever
     else you know set on the dependency itself and let the missing field
     compute the specific unresolved reason. Each candidate carries its own
     `style` and a lean `package`; leave the dependency's
     own `style`, `package`, and `specPath` unset until one is pinned.
   - You can't even identify what system fills the need → emit a style-less
     entry (no `style`, no `candidates`): just `name` + a `description` saying
     what's missing and what the user needs to supply. The platform computes
     this as `unresolved`/`needs-input`.
7. **On pin** (a chat turn collapses `candidates` to one choice): REMOVE the
   `candidates` field entirely (never leave a one-item array — that's a schema
   violation), and set the chosen option's `style` and `package`/`specPath`
   (a spec URL or a stored-file path).

**Config-key conventions.** `config` is the env-var schema the consuming
component codes against. Use `SCREAMING_SNAKE_CASE` keys. `secret` is opt-in:
set `"secret": true` ONLY for credentials (they route through the secret path);
OMIT it entirely for plain config — a key with no `secret` field is non-secret.
Give each key an optional `description` — a short note on what the value is and
where the user finds it (e.g. `{ "key": "STRIPE_API_KEY", "secret": true,
"description": "Your Stripe secret API key" }`); the Build dependency drawer
shows it under the field. For a NON-secret key whose sensible default you can
infer (a region, a base URL), add an optional `defaultValue` — the drawer
pre-fills the field with it (e.g. `{ "key": "AWS_REGION", "defaultValue":
"us-east-1" }`). NEVER set `defaultValue` for a secret (`"secret": true`) — a
credential like an API key has no default to invent. Keep the keys minimal —
only what the component reads.

**Secure placement — a secret-bearing `external` dependency belongs on a
`service`, not a `web-application`.** A web-application ships to the browser,
so any secret it holds is visible to whoever opens dev tools. The secure
default: attach the dependency (and its `secret: true` config keys) to a
backend `service`, and have the web-application reach it through a
`component` (or `org-service`) dependency on that service instead — the
service PROXIES the external API, and the web-app never sees the third-party
credential. A web-application may declare an `external` dependency directly
only when NONE of its `config` keys need `secret: true` — a genuinely public
API, or one authenticated by the END USER's own in-browser credentials/OAuth
(never a shared platform secret riding along as a "public" key). If you're
about to set `secret: true` on a config key for a dependency declared on a
`web-application`, that's the signal to move it onto a service instead: add
(or reuse) a service that calls the external API, redeclare the dependency
there, and give the web-app a `component` edge to that service. This is a
design-time judgment call the architect makes — the schema does not reject a
secret on a web-application — so apply it as the secure default, not a rule
to route around.

**Resolution is entirely derived — you never author `status`/`reason`, and
`needsSpec` no longer exists.** The platform computes `status`/`reason` at read
time from which fields are present, first match wins: `candidates` present
(2+) → `ambiguous`; dependency `name` matches a registered external resource →
`resolved` (registry reuse, regardless of `style`); `style` absent →
`unresolved`/`needs-input`; `style: "rest-api"` with no `specPath` →
`unresolved`/`needs-spec`;
`style: "sdk"` with no `package` → `unresolved`/`needs-input`; otherwise →
`resolved`. Declare the intent (kind + name + the fields above) and let the
platform derive the state — the old `needsSpec` boolean is REMOVED from the
schema (a draft carrying it now fails the write-gate); migrate
`needsSpec: true` to `style: "rest-api"`. An `external` dependency should
almost always carry at least one `config` key — the value-collection gate
needs something to collect.

### Resolving or reconsidering a named dependency on request

A later chat turn may point you at a single dependency by name — a lean
message like "resolve the `email` dependency on `notification-service`" or
"reconsider the `stripe` dependency on `billing-api`". The message carries no
dependency JSON and no playbook by design — you already have both: read that
dependency's current entry from
`specs/design/components/<component>/design.json` (it's in the turn's
snapshot), then act on its current state:

- **Ambiguous — it already carries `candidates`.** The user clicked to CHOOSE,
  so hand them the choice: list the candidate options with a one-line
  distinction each, and add that they may pick one of these or name another
  relevant option. Pin the option the user names — the same signal rule as
  discovery, so with no signal the choice stays theirs. Once they name one,
  apply that candidate's `kind` playbook to finalize `style`/`package`/
  `specPath`/`config`, and REMOVE the `candidates` array per step 7.
- **Unresolved — needs-input or needs-spec, no `candidates`.** Apply the
  discovery/classification playbook above for its `kind` (sibling check for
  `component`, `list_org_endpoints` for `org-service`,
  `list_platform_resource_types` for `platform-resource`, the full `external`
  procedure). A signal-backed winner → pin it; 2+ equals with no signal → emit
  them as `candidates` and let the user choose.
- **Reconsider — it's already resolved.** Present fresh alternatives as
  `candidates`, or repin to the one the user names, removing `candidates` once
  one is chosen.

Edit ONLY that one dependency's entry: re-emit the component's whole
`design.json` (never a patch) with every other field and dependency carried
over exactly as they were.

Every dependency carries a one-line `description`: what the target is and how
the component uses it (for an `external`, which endpoints/SDK and auth scheme;
for an `org-service`, the specific operations/paths it calls from the
provider's discovered contract — or that no contract was resolvable, never a
guess; for a `platform-resource`, what it stores). The console shows it in the
dependency drawer and the coding agent relies on it to integrate correctly.

One component per directory. Every `web-application` gets a `wireframes.dsl`
(load `excalidraw-wireframes` before writing it); every `service` gets an
`openapi.yaml` (load `openapi-conventions` before writing it), emitted LAST. Other
kinds (scheduled tasks, workers, ...) carry no extra artifact yet — capture
their behavior fully in `description` and `dependencies`.
