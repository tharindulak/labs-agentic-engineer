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

package provisioning

import (
	"context"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/spec"
)

type fakeEndpoints struct {
	nsVisible map[string]openchoreo.WorkloadEndpointInfo
	project   map[string]openchoreo.WorkloadEndpointInfo
}

func (f *fakeEndpoints) ResolveNamespaceVisible(_ context.Context, _, name string) (openchoreo.WorkloadEndpointInfo, bool, error) {
	ep, ok := f.nsVisible[name]
	return ep, ok, nil
}
func (f *fakeEndpoints) ResolveProjectEndpoint(_ context.Context, _, _, ocComponent string) (openchoreo.WorkloadEndpointInfo, bool, error) {
	ep, ok := f.project[ocComponent]
	return ep, ok, nil
}

func TestOrgServiceURLEnvAndEnvVarName(t *testing.T) {
	// Byte parity with endpoints.OrgServiceURLEnv / the upstream envVarName.
	cases := map[string]string{"employee-api": "EMPLOYEE_API_URL", "todo": "TODO_URL", "order-svc-2": "ORDER_SVC_2_URL"}
	for in, want := range cases {
		if got := orgServiceURLEnv(in); got != want {
			t.Errorf("orgServiceURLEnv(%q) = %q, want %q", in, got, want)
		}
	}
	if got := envVarName("orders-db", "host"); got != "ORDERS_DB_HOST" {
		t.Errorf("envVarName(orders-db, host) = %q, want ORDERS_DB_HOST", got)
	}
}

func TestWiring_PostsResolvedDependencies(t *testing.T) {
	comp := spec.DesignComponent{
		Name: "web",
		Dependencies: []spec.Dependency{
			{Kind: spec.DependencyKindOrgService, Name: "employee-api"},
			{Kind: spec.DependencyKindComponent, Name: "orders"},
			{Kind: spec.DependencyKindExternal, Name: "stripe"},
			{Kind: spec.DependencyKindPlatformResource, Name: "orders-db", ResourceType: "postgres-cnpg",
				Description: "Managed PostgreSQL via CloudNativePG"},
		},
	}
	eps := &fakeEndpoints{
		nsVisible: map[string]openchoreo.WorkloadEndpointInfo{
			"employee-api": {Project: "hr", Component: "hr-employee-api", Name: "http"},
		},
		project: map[string]openchoreo.WorkloadEndpointInfo{
			"proj-orders": {Component: "proj-orders", Name: "http"},
		},
	}
	bindings := &fakeBindings{byName: map[string]*openchoreo.ResourceReleaseBinding{
		"proj-stripe-development":    readyBinding("STRIPE_API_KEY"),
		"proj-orders-db-development": readyBinding("host", "port"),
	}}
	issues := newFakeIssues(nil)
	w := NewWiringResolver(fakeDesign{comps: []spec.DesignComponent{comp}}, eps, bindings, issues)

	if err := w.PostResolvedDeps(context.Background(), "org", "proj", 5, "web"); err != nil {
		t.Fatalf("PostResolvedDeps: %v", err)
	}
	posted := issues.comments[5]
	if len(posted) != 1 {
		t.Fatalf("want one wiring comment, got %d", len(posted))
	}
	body := posted[0]
	// Exact ADR-0004 header.
	if !strings.HasPrefix(body, "**Platform-resolved dependencies** — add the following to this component's `workload.yaml`") {
		t.Fatalf("wiring comment header wrong:\n%s", body)
	}
	if !strings.Contains(body, "```yaml\ndependencies:\n") {
		t.Fatalf("wiring comment must embed a yaml dependencies block:\n%s", body)
	}
	// org-service endpoint: namespace visibility + <UPPER>_URL address.
	for _, want := range []string{
		"visibility: namespace", "address: EMPLOYEE_API_URL",
		"visibility: project", "address: ORDERS_URL",
		"ref: proj-stripe", "STRIPE_API_KEY: STRIPE_API_KEY",
		"ref: proj-orders-db", "ORDERS_DB_HOST", "ORDERS_DB_PORT",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("wiring comment missing %q:\n%s", want, body)
		}
	}
	// No secret values leak — outputs are names/env-var names only.
	if strings.Contains(body, "password") {
		t.Errorf("unexpected token in wiring comment (no values should appear):\n%s", body)
	}
	// Consumed API contract guidance: org-service dep names the resolved
	// provider + instructs the agent to fetch the real contract via MCP.
	for _, want := range []string{
		"### Consumed API contract — employee-api",
		"project `hr`, component `hr-employee-api`, endpoint `http`",
		"list_org_component_endpoints",
		"Do NOT invent endpoints.",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("wiring comment missing consumed-contract text %q:\n%s", want, body)
		}
	}
	// Same-project component dep gets the "local" variant: read the sibling's
	// checked-out openapi.yaml, no MCP round-trip needed.
	for _, want := range []string{
		"### Consumed API contract — orders (local)",
		"specs/design/components/orders/openapi.yaml",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("wiring comment missing local consumed-contract text %q:\n%s", want, body)
		}
	}
	// external/platform-resource deps get no "Consumed API contract" section —
	// that heading is reserved for org-service/same-project endpoint deps
	// (and, separately, external deps with a stored spec — see
	// TestWiring_ExternalDepWithSpecGetsContractLine). stripe here has no
	// specPath, so it renders nothing at all.
	if strings.Contains(body, "Consumed API contract — stripe") || strings.Contains(body, "Consumed API contract — orders-db") {
		t.Errorf("unexpected consumed-contract section for a non-endpoint dep:\n%s", body)
	}
	// Platform-resource dep: resourceType + catalog description + outputs→env
	// mapping — the coding agent's only handle to identify the underlying
	// technology (Task 12's SDK-docs lookup).
	for _, want := range []string{
		"**Provisioned platform resources**",
		"### Platform resource — orders-db",
		"Resource type: `postgres-cnpg` — Managed PostgreSQL via CloudNativePG.",
		"Outputs → env: ORDERS_DB_HOST, ORDERS_DB_PORT.",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("wiring comment missing platform-resource identity text %q:\n%s", want, body)
		}
	}
}

// TestWiring_ExternalDepWithSpecGetsContractLine covers Task 11: an `external`
// dependency whose OpenAPI spec was collected and committed at design time
// (specPath set) must get an exact "Consumed API contract" line pointing the
// coding agent at that stored spec — independent of whether the connection's
// resource binding is ready yet (the spec is a static repo artifact, not a
// runtime resolution).
func TestWiring_ExternalDepWithSpecGetsContractLine(t *testing.T) {
	comp := spec.DesignComponent{
		Name: "web",
		Dependencies: []spec.Dependency{
			{Kind: spec.DependencyKindExternal, Name: "stripe", Style: spec.DependencyStyleRestAPI,
				SpecPath: "dependencies/stripe.openapi.yaml"},
			{Kind: spec.DependencyKindPlatformResource, Name: "orders-db"}, // ensures block is non-empty
		},
	}
	bindings := &fakeBindings{byName: map[string]*openchoreo.ResourceReleaseBinding{
		"proj-orders-db-development": readyBinding("host"),
	}}
	issues := newFakeIssues(nil)
	w := NewWiringResolver(fakeDesign{comps: []spec.DesignComponent{comp}}, &fakeEndpoints{}, bindings, issues)

	if err := w.PostResolvedDeps(context.Background(), "org", "proj", 7, "web"); err != nil {
		t.Fatalf("PostResolvedDeps: %v", err)
	}
	posted := issues.comments[7]
	if len(posted) != 1 {
		t.Fatalf("want one wiring comment, got %d", len(posted))
	}
	body := posted[0]
	// specPath is a repo file path here → the contract line names the dep + its
	// specPath and marks it the source of truth (relaxed wording — the coding
	// agent researches beyond it).
	if !strings.Contains(body, "External API contract for `stripe`: `dependencies/stripe.openapi.yaml`") ||
		!strings.Contains(body, "source of truth") {
		t.Errorf("wiring comment missing the external contract line:\ngot body:\n%s", body)
	}
	// The relaxed wording must NOT carry the old hard restriction.
	if strings.Contains(body, "do not invent endpoints") {
		t.Errorf("external contract line should be relaxed (no 'do not invent endpoints'):\n%s", body)
	}
}

// TestWiring_ExternalDepWithoutSpecGetsNoContractLine: an `external` dep with
// no specPath (unresolved, or an `sdk`-style dep that never has one) gets no
// "Consumed API contract" line — the platform never invents a stored spec
// that doesn't exist.
func TestWiring_ExternalDepWithoutSpecGetsNoContractLine(t *testing.T) {
	comp := spec.DesignComponent{
		Name: "web",
		Dependencies: []spec.Dependency{
			{Kind: spec.DependencyKindExternal, Name: "stripe"},
			{Kind: spec.DependencyKindPlatformResource, Name: "orders-db"}, // ensures block is non-empty
		},
	}
	bindings := &fakeBindings{byName: map[string]*openchoreo.ResourceReleaseBinding{
		"proj-orders-db-development": readyBinding("host"),
	}}
	issues := newFakeIssues(nil)
	w := NewWiringResolver(fakeDesign{comps: []spec.DesignComponent{comp}}, &fakeEndpoints{}, bindings, issues)

	if err := w.PostResolvedDeps(context.Background(), "org", "proj", 9, "web"); err != nil {
		t.Fatalf("PostResolvedDeps: %v", err)
	}
	body := issues.comments[9][0]
	if strings.Contains(body, "Consumed API contract") {
		t.Errorf("no specPath must render no consumed-contract line:\n%s", body)
	}
}

func TestWiring_EmptyResolutionPostsNothing(t *testing.T) {
	comp := spec.DesignComponent{Name: "web"} // no deps
	issues := newFakeIssues(nil)
	w := NewWiringResolver(fakeDesign{comps: []spec.DesignComponent{comp}}, &fakeEndpoints{}, &fakeBindings{}, issues)
	if err := w.PostResolvedDeps(context.Background(), "org", "proj", 5, "web"); err != nil {
		t.Fatalf("PostResolvedDeps: %v", err)
	}
	if len(issues.comments[5]) != 0 {
		t.Fatalf("no deps → no comment, got %v", issues.comments[5])
	}
}
