// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

package contracts

// Dependency wire DTOs live here (the dependency-free leaf) so the generated
// contract package (internal/gen) can name them via x-go-type without importing
// a domain — keeping gen, and therefore everything reachable from platform,
// domain-free (TestPlatformImportsNoDomain / TestContractsIsLeaf). The spec
// domain re-exports these as spec.Dependency / spec.ConfigKey / … and owns all
// behaviour over them (ComputeDependencyStatus, the enum consts, validators);
// this file carries only the shapes, per the "domains re-export contracts
// types, never the reverse" rule.

// DependencyKind discriminates the unified Dependency entry. The concrete kind
// consts (component / org-service / external / platform-resource) live in the
// spec domain, which owns the resolution algebra.
type DependencyKind = string

// DependencyStyle is the closed set of external dependency shapes (mirrors the
// agent-stream TS `DependencyStyle`). Meaningful only on kind=external. The
// concrete style consts live in the spec domain.
type DependencyStyle = string

// Dependency is the unified, kind-discriminated dependency entry on a
// component. It subsumes the legacy DependsOn (sibling components) and the
// external HTTP APIs a component consumed at runtime. Go has no native
// discriminated union, so a single struct carries every kind's fields; `Kind`
// selects which are meaningful (Config for external; ResourceType/Parameters
// for platform-resource; the rest common). Mirrors the agents-service Zod
// `Dependency`.
type Dependency struct {
	Kind        DependencyKind `json:"kind"`
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	// Status and Reason are READ-TIME computed fields, derived by
	// ComputeDependencyStatus (the single resolution authority) against
	// freshly-fetched resolver-port lookups on every design read; they are NOT
	// persisted and carry NO gorm/yaml tags — plain wire JSON only. The
	// architect never sets them.
	//   Status: resolved|ambiguous|unresolved|blocked
	//   Reason: needs-spec|needs-input|not-found|access-required
	Status string `json:"status,omitempty"`
	Reason string `json:"reason,omitempty"`
	// external: REST API ("rest-api") or SDK ("sdk") shape. Meaningful ONLY on
	// kind=external — a platform-resource is catalog-picked, an org-service is
	// catalog-resolved; neither has web provenance. Every resolution state is
	// DERIVED from which of Style/Package/Candidates/SpecPath are present, never
	// a stored flag (the old NeedsSpec boolean is gone). Enforced mechanically by
	// the zod write-gate (superRefine) and the Go fold validator (agentfold), not
	// by this struct.
	Style DependencyStyle `json:"style,omitempty"`
	// external (sdk style): one ecosystem-prefixed package identifier, e.g.
	// "npm:stripe@^14" — version inline but optional (omitted ⇒ latest
	// compatible). External-only.
	Package string `json:"package,omitempty"`
	// external: the contract location — EITHER a URL (a public spec/docs URL) OR
	// a repo-relative path (dependencies/<name>.openapi.yaml) once a spec has been
	// collected into the consumer's own repo. External-only.
	SpecPath string `json:"specPath,omitempty"`
	// external: 2+ identified-but-not-pinned options — the "ambiguous"
	// resolution state. Omitted, never empty: one option fully known collapses
	// to a resolved dep, one option partially known is a partial dep (not a
	// candidate), 2+ identified options is ambiguous. Pinning REMOVES the
	// field. External-only.
	Candidates []DependencyCandidate `json:"candidates,omitempty"`
	// external: the config key schema the consuming component codes against.
	Config []ConfigKey `json:"config,omitempty"`
	// platform-resource: the registered (Cluster)ResourceType + provisioning params.
	// Parameter values are mixed scalar types (string | number | bool) per the
	// target (Cluster)ResourceType's OpenAPI v3 schema — e.g. postgres-cnpg's
	// `instances` is an integer while `storage`/`version` are strings — so the
	// map is any-valued and marshalled verbatim into the OC Resource
	// spec.parameters (numbers must stay JSON numbers for CRD validation).
	ResourceType string         `json:"resourceType,omitempty"`
	Parameters   map[string]any `json:"parameters,omitempty"`
}

// DependencyCandidate is one option in an ambiguous external dependency's
// resolution set (2+ required — see Dependency.Candidates; a single candidate
// never occurs). Mirrors the agent-stream TS `DependencyCandidate`.
type DependencyCandidate struct {
	Name        string          `json:"name"`
	Style       DependencyStyle `json:"style"`
	Description string          `json:"description,omitempty"`
	// Package: sdk-style candidates only; ecosystem-prefixed package identifier.
	Package string `json:"package,omitempty"`
}

// ConfigKey is one env-var key a component reads at runtime. For an external
// resource these keys form the resource's schema (drives the OC ResourceType).
// Secret keys route through the secret path. `secret` is optional and omitted
// when false — a key with no `secret` field is a plain (non-secret) config value.
type ConfigKey struct {
	Key    string `json:"key"`
	Secret bool   `json:"secret,omitempty"`
	// Description is an optional human-readable note on what this value is for,
	// authored alongside the key. The Build dependency drawer renders it under
	// the field so the user knows what to supply.
	Description string `json:"description,omitempty"`
	// DefaultValue is an optional suggested initial value the agent MAY set for a
	// NON-secret key it can infer a sensible default for (a region, a base URL).
	// The Build dependency drawer pre-fills the field with it. Never set for a
	// secret key — a credential has no default to invent.
	DefaultValue string `json:"defaultValue,omitempty"`
}
