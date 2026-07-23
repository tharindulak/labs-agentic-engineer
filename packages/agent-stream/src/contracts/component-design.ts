/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * ComponentDesign — the AUTHORED per-component design file at
 * `specs/design/components/<name>/design.json`. This replaces the
 * component-level design.md: the spec agent writes it (whole-file rewrites,
 * schema-validated by the FileBundle on every write), downstream consumers
 * (design projection, coding-agent dispatch, task generation) read it
 * directly. `skillsApplied` is a key HERE (per-component), NOT in design.md
 * frontmatter; the top-level design.md is prose + an optional `sourceSpec`
 * frontmatter only. The Zod validator (`componentDesignSchema` in
 * `../component-design-schema.ts`) is drift-guarded against this type.
 */

export interface ComponentDesign {
  /** Must equal the component's directory name (kebab-case). */
  name: string;
  /**
   * Component kind. "service" and "web-application" carry full platform
   * conventions (openapi.yaml / wireframes.dsl and deployment support) and
   * mirror OpenChoreo's own terms (deployment/service,
   * deployment/web-application — the same words minus the prefix); any other kind
   * the requirements imply (e.g. "scheduled-task", "worker") is CAPTURED at
   * design time — support-gating happens in later phases, not here.
   */
  type: string;
  /** Semantic version; "0.1.0" for a new component. */
  version: string;
  /** Implementation language, e.g. "Go", "TypeScript". */
  language: string;
  /**
   * The build buildpack — always "docker" (the platform's single build path).
   * The agent write-gate (checkComponentDesign) pins this to "docker" as a
   * post-parse check, so the type stays `string` and the shared JSON Schema /
   * BFF save-gate stay permissive.
   */
  buildpack: string;
  /** Repo-relative source dir — the component name. */
  appPath: string;
  /** Deploy entry, e.g. "deployment/service". */
  entrypoint: string;
  /** Gateway exposure of the component's endpoint. */
  exposure: "internet" | "intranet";
  /**
   * Unified, kind-discriminated dependency edges — the successor to the
   * legacy `connections[]`. Mirrors the aep-api Go `models.Dependency` MINUS
   * `status`/`reason` (those are PLATFORM-COMPUTED at read time against the
   * live catalog — never authored, presence of either is a schema violation).
   */
  dependencies: Dependency[];
  /** The single-responsibility paragraph (what it does / does NOT do). */
  description: string;
  /**
   * Optional. The single network endpoint the component exposes. Its `name`
   * is the SINGLE SOURCE OF TRUTH for the endpoint name: the coding agent
   * writes the same name into `workload.yaml` (`spec.endpoints[].name`) and
   * the platform's managed-API (`api-configuration`) trait binds to it. When
   * omitted, both sides default to the conventional name `"http"`. The port
   * is NOT declared here — it stays in `workload.yaml`, chosen to match the
   * app's actual listen port. Mirrors Go `models.ComponentEndpoint`.
   */
  endpoint?: Endpoint;
  /**
   * PLATFORM-OWNED (optional). Managed-API exposure policy for a service, set
   * by the platform — the agent must NOT invent it. Round-trips through the
   * file untouched. Mirrors Go `models.ExposesAPI`.
   */
  exposesAPI?: ExposesAPI;
  /**
   * PLATFORM-OWNED (optional). Extra instructions the platform injects for the
   * downstream coding agent. Passthrough — the design agent must not author it.
   */
  componentAgentInstructions?: string;
  /** Skill names applied to THIS component (per-component; the coding runner
   *  materializes exactly these for a build of this component). */
  skillsApplied?: string[];
}

/**
 * The single network endpoint a component exposes. Only the `name` is
 * declared — it is the shared key the coding agent's `workload.yaml` and the
 * platform's `api-configuration` trait both reference. Mirrors Go
 * `models.ComponentEndpoint`.
 */
export interface Endpoint {
  /** Workload endpoint name (the `spec.endpoints[].name` key). Defaults to "http" when the component declares no endpoint. */
  name: string;
}

/** The closed set of dependency kinds (mirrors Go `models.DependencyKind`). */
export type DependencyKind = "component" | "org-service" | "external" | "platform-resource";

/** The closed set of external dependency shapes (mirrors Go `models.DependencyStyle`). */
export type DependencyStyle = "rest-api" | "sdk";

/**
 * One unified dependency edge. A single flat shape carries every kind's
 * fields; `kind` selects which are meaningful — mirroring the Go codec, which
 * uses one struct and is LENIENT about kind-specific fields (it does not
 * reject, e.g., `resourceType` on an `external` dep). Only `kind` (closed set)
 * and `name` are required; every other field is optional. `status`/`reason`
 * are deliberately ABSENT — they are read-time computed, never authored.
 *
 * `style`/`package`/`specPath`/`candidates` are meaningful only on
 * `kind: "external"` — a `platform-resource` is catalog-picked, an
 * `org-service` is catalog-resolved, neither has web provenance. Every
 * resolution state (resolved / ambiguous / unresolved) is
 * DERIVED from which of these fields are present, never stored as a flag: the
 * old `needsSpec` boolean is gone (a boolean can contradict reality; a missing
 * field cannot).
 */
export interface Dependency {
  kind: DependencyKind;
  /** Sibling component / org-service provider / external system / resource name. */
  name: string;
  description?: string;
  /** external: REST API ("rest-api") or SDK ("sdk") shape. External-only. */
  style?: DependencyStyle;
  /**
   * external (sdk style): one ecosystem-prefixed package identifier, e.g.
   * "npm:stripe@^14" — version inline but optional (omitted ⇒ latest
   * compatible). External-only.
   */
  package?: string;
  /**
   * external: the contract location — either a URL to a published OpenAPI
   * spec (recorded as-is, NOT fetched-and-stored) or a repo-relative path to a
   * user-provided committed spec (dependencies/<name>.openapi.yaml).
   */
  specPath?: string;
  /**
   * external: 2+ identified-but-not-pinned options — the "ambiguous"
   * resolution state. Omitted, never empty: one option fully known ⇒
   * resolved; one option partially known ⇒ a partially-filled dep (not a
   * candidate); 2+ identified options ⇒ ambiguous. Pinning REMOVES the field.
   * External-only.
   */
  candidates?: DependencyCandidate[];
  /** external: the config-key schema the consuming component codes against. */
  config?: ConfigKey[];
  /** platform-resource: the registered (Cluster)ResourceType. */
  resourceType?: string;
  /**
   * platform-resource: provisioning parameters. Values are mixed scalar types
   * per the target (Cluster)ResourceType schema (e.g. postgres-cnpg: `instances`
   * is an integer, `storage`/`version` are strings), marshalled verbatim into
   * the OpenChoreo Resource spec.parameters.
   */
  parameters?: Record<string, string | number | boolean>;
}

/**
 * One option in an ambiguous external dependency's resolution set (2+
 * required — see `Dependency.candidates`; a single candidate never occurs).
 * Mirrors Go `models.DependencyCandidate`.
 */
export interface DependencyCandidate {
  name: string;
  style: DependencyStyle;
  description?: string;
  /** sdk-style candidates only: ecosystem-prefixed package identifier. */
  package?: string;
}

/** One env-var key a component reads at runtime. Mirrors Go `models.ConfigKey`. */
export interface ConfigKey {
  key: string;
  /** Secret keys route through the secret path. Default: false. */
  secret?: boolean;
  /** Optional human-readable note on what this value is for; the Build dependency drawer renders it under the field. */
  description?: string;
  /** Optional suggested initial value for a NON-secret key (a region, a base URL); the Build dependency drawer pre-fills the field with it. Never set for a secret. */
  defaultValue?: string;
}

/** Managed-API exposure policy (platform-owned). Mirrors Go `models.ExposesAPI`. */
export interface ExposesAPI {
  managed?: boolean;
  /** "end-user-required" | "service-required" | "none". */
  auth?: string;
  /** injected header name, e.g. "X-User-Id". */
  userContext?: string;
  /** endpoint consumable by OTHER projects in the org. */
  orgPublished?: boolean;
}
