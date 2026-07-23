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

package agentfold

import (
	"fmt"
	"strings"
	"testing"
)

// designWithEndpoint builds a minimal valid component design.json for dir "svc",
// splicing in the given `endpoint` fragment (or none when empty).
func designWithEndpoint(endpointFragment string) string {
	ep := ""
	if endpointFragment != "" {
		ep = `,"endpoint":` + endpointFragment
	}
	return fmt.Sprintf(`{"name":"svc","type":"service","version":"0.1.0",`+
		`"language":"Go","buildpack":"docker","appPath":"svc",`+
		`"entrypoint":"deployment/service","exposure":"internet",`+
		`"description":"x","dependencies":[]%s}`, ep)
}

// TestDesignGate_Endpoint locks fold-parity for the design.json `endpoint`
// block against the zod endpointSchema (component-design-schema.ts): a
// zod-accepted write must fold here, and a zod-rejected shape must reject here.
func TestDesignGate_Endpoint(t *testing.T) {
	cases := []struct {
		name     string
		fragment string
		wantOK   bool
	}{
		{"absent — still valid", "", true},
		{"valid name", `{"name":"http"}`, true},
		{"valid non-default name", `{"name":"api"}`, true},
		{"empty name rejected", `{"name":""}`, false},
		{"unknown key rejected", `{"name":"http","port":8080}`, false},
		{"not an object rejected", `"http"`, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := validateComponentDesign(designWithEndpoint(c.fragment), "svc")
			if c.wantOK && p != nil {
				t.Fatalf("want accepted, got rejected: %s", p.message)
			}
			if !c.wantOK && p == nil {
				t.Fatalf("want rejected, got accepted")
			}
		})
	}
}

// TestDesignGate_TypeAliasRejected locks the canonical-kind rule in parity with
// the zod gate: the wrong web-application spellings reject; the canonical value
// and other kinds accept.
func TestDesignGate_TypeAliasRejected(t *testing.T) {
	tmpl := func(typ string) string {
		return fmt.Sprintf(`{"name":"svc","type":%q,"version":"0.1.0","language":"Go",`+
			`"buildpack":"docker","appPath":"svc","entrypoint":"deployment/service",`+
			`"exposure":"internet","description":"x","dependencies":[]}`, typ)
	}
	cases := []struct {
		typ    string
		wantOK bool
	}{
		{"service", true},
		{"web-application", true},
		{"worker", true},
		{"webapp", false},
		{"web-app", false},
		{"WebApp", false},
		{"webApplication", false},
	}
	for _, c := range cases {
		t.Run(c.typ, func(t *testing.T) {
			p := validateComponentDesign(tmpl(c.typ), "svc")
			if c.wantOK && p != nil {
				t.Fatalf("type %q: want accepted, got %s", c.typ, p.message)
			}
			if !c.wantOK && p == nil {
				t.Fatalf("type %q: want rejected (canonical is web-application), got accepted", c.typ)
			}
		})
	}
}

// designWithParams renders a schema-valid component design.json whose single
// platform-resource dependency carries the given raw `parameters` JSON literal.
func designWithParams(paramsJSON string) string {
	return fmt.Sprintf(`{
  "name": "orders-db-owner",
  "type": "service",
  "version": "0.1.0",
  "language": "Go",
  "buildpack": "docker",
  "appPath": "svc",
  "entrypoint": "cmd/main",
  "exposure": "internet",
  "description": "owns orders data",
  "dependencies": [
    {
      "kind": "platform-resource",
      "name": "orders-db",
      "resourceType": "postgres-cnpg",
      "parameters": %s
    }
  ]
}`, paramsJSON)
}

// TestValidateComponentDesign_Parameters locks the parameters value rule in
// parity with the zod gate (component-design-schema.ts:
// z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))): mixed
// scalar values are accepted, non-scalar values reject. This is the write-gate
// half of the fold-parity fix for the number-vs-string divergence.
func TestValidateComponentDesign_Parameters(t *testing.T) {
	const dir = "orders-db-owner"

	accept := []struct {
		name   string
		params string
	}{
		// The postgres-cnpg shape: instances is an integer, storage/version strings.
		{"mixed scalars (number + strings)", `{ "instances": 1, "storage": "5Gi", "version": "16" }`},
		{"boolean value", `{ "highAvailability": true }`},
		{"empty object", `{}`},
	}
	for _, tc := range accept {
		t.Run("accept/"+tc.name, func(t *testing.T) {
			if p := validateComponentDesign(designWithParams(tc.params), dir); p != nil {
				t.Fatalf("expected accept, got reject: %s", p.message)
			}
		})
	}

	reject := []struct {
		name   string
		params string
	}{
		{"object value", `{ "instances": { "nested": 1 } }`},
		{"array value", `{ "zones": ["a", "b"] }`},
		{"null value", `{ "instances": null }`},
		{"parameters not an object", `"not-an-object"`},
	}
	for _, tc := range reject {
		t.Run("reject/"+tc.name, func(t *testing.T) {
			p := validateComponentDesign(designWithParams(tc.params), dir)
			if p == nil {
				t.Fatalf("expected reject for params %s, got accept", tc.params)
			}
			if p.code != ErrSchemaViolation {
				t.Fatalf("code = %q, want %q", p.code, ErrSchemaViolation)
			}
		})
	}
}

// designWithSkills builds a minimal valid component design.json for dir "svc",
// optionally injecting a `skillsApplied` value verbatim from fragment.
func designWithSkills(fragment string) string {
	sa := ""
	if fragment != "" {
		sa = `,"skillsApplied":` + fragment
	}
	return fmt.Sprintf(`{"name":"svc","type":"service","version":"0.1.0",`+
		`"language":"Go","buildpack":"docker","appPath":"svc",`+
		`"entrypoint":"deployment/service","exposure":"internet",`+
		`"description":"x","dependencies":[]%s}`, sa)
}

// designWithDependency builds a minimal valid component design.json for dir
// "svc" whose sole dependency is the given raw dependency-object JSON literal.
func designWithDependency(depFragment string) string {
	return fmt.Sprintf(`{"name":"svc","type":"service","version":"0.1.0",`+
		`"language":"Go","buildpack":"docker","appPath":"svc",`+
		`"entrypoint":"deployment/service","exposure":"internet",`+
		`"description":"x","dependencies":[%s]}`, depFragment)
}

// TestDesignGate_ExternalOnlyDependencyFields locks the superRefine
// kind-conditioning gate (designgate.go's externalOnlyDependencyKeys, the Go
// mirror of component-design-schema.ts's EXTERNAL_ONLY_DEPENDENCY_FIELDS /
// dependencySchema.superRefine — see services/agents' component-design.test.ts
// for the TS-side twin of this table): each of the four external-only fields
// (candidates, style, package, specPath) must reject on a non-"external" kind
// and accept on kind="external".
func TestDesignGate_ExternalOnlyDependencyFields(t *testing.T) {
	fields := []struct {
		field string
		value string // raw JSON literal for the field's value
	}{
		{"candidates", `[{"name":"sendgrid-rest","style":"rest-api"},{"name":"resend-sdk","style":"sdk"}]`},
		{"style", `"sdk"`},
		{"package", `"npm:stripe@^14"`},
		{"specPath", `"dependencies/stripe.openapi.yaml"`},
	}
	for _, f := range fields {
		t.Run(f.field+"/rejected on kind=org-service", func(t *testing.T) {
			dep := fmt.Sprintf(`{"kind":"org-service","name":"identity","%s":%s}`, f.field, f.value)
			p := validateComponentDesign(designWithDependency(dep), "svc")
			if p == nil {
				t.Fatalf("want rejected (external-only field %q on kind=org-service), got accepted", f.field)
			}
			if p.code != ErrSchemaViolation {
				t.Fatalf("code = %q, want %q", p.code, ErrSchemaViolation)
			}
			if !strings.Contains(p.message, f.field) {
				t.Fatalf("message %q does not mention field %q", p.message, f.field)
			}
		})
		t.Run(f.field+"/accepted on kind=external", func(t *testing.T) {
			dep := fmt.Sprintf(`{"kind":"external","name":"stripe","%s":%s}`, f.field, f.value)
			p := validateComponentDesign(designWithDependency(dep), "svc")
			if p != nil {
				t.Fatalf("want accepted (external-only field %q on kind=external), got rejected: %s", f.field, p.message)
			}
		})
	}
}

// TestDesignGate_RetiredExternalFieldsRejected documents the hard-break: the
// specUrl (URL hint) and sources (provenance array) fields were removed from
// the dependency schema — the coding agent now researches contracts freely
// from the web, so neither is authored. Like status/reason and the retired
// needsSpec, they are no longer in the known-key set and reject as unknown keys
// (strictObject) even on kind="external". Parity with the zod gate, whose
// strictObject stopped listing them.
func TestDesignGate_RetiredExternalFieldsRejected(t *testing.T) {
	for _, f := range []struct{ field, value string }{
		{"specUrl", `"https://example.com/stripe.yaml"`},
		{"sources", `["https://stripe.com/docs/api"]`},
	} {
		t.Run(f.field+"/rejected on kind=external", func(t *testing.T) {
			dep := fmt.Sprintf(`{"kind":"external","name":"stripe","%s":%s}`, f.field, f.value)
			p := validateComponentDesign(designWithDependency(dep), "svc")
			if p == nil {
				t.Fatalf("want rejected (retired field %q), got accepted", f.field)
			}
			if p.code != ErrSchemaViolation {
				t.Fatalf("code = %q, want %q", p.code, ErrSchemaViolation)
			}
			if !strings.Contains(p.message, f.field) {
				t.Fatalf("message %q does not mention field %q", p.message, f.field)
			}
		})
	}
}

func TestDesignGate_SkillsApplied(t *testing.T) {
	cases := []struct {
		name     string
		fragment string
		wantOK   bool
	}{
		{"absent — valid", "", true},
		{"empty array — valid", `[]`, true},
		{"string array — valid", `["go","openapi-conventions"]`, true},
		{"not an array — rejected", `"go"`, false},
		{"non-string element — rejected", `["go",3]`, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := validateComponentDesign(designWithSkills(c.fragment), "svc")
			if c.wantOK && p != nil {
				t.Fatalf("want accepted, got: %s", p.message)
			}
			if !c.wantOK && p == nil {
				t.Fatalf("want rejected, got accepted")
			}
		})
	}
}
