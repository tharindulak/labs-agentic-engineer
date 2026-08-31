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
	"encoding/json"
	"testing"

	"github.com/wso2/aep/aep-api/internal/dependencies"
	"github.com/wso2/aep/aep-api/internal/platform/securityspec"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// thunder-app is a TEST FIXTURE type name the fake catalog marks end-user-auth.
// Production overlay keys on the CRT marker, never this string.

type fakeMarkers struct {
	byName map[string]dependencies.TypeMarkers
	err    error
}

func (f *fakeMarkers) MarkersByName(context.Context) (map[string]dependencies.TypeMarkers, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.byName, nil
}

func endUserAuthMarkers() *fakeMarkers {
	return &fakeMarkers{byName: map[string]dependencies.TypeMarkers{
		"thunder-app":   {EndUserAuth: true},
		"postgres-cnpg": {EndUserAuth: false},
	}}
}

type fakeSecurityJSON struct {
	raw     []byte
	err     error
	lastTag string
}

func (f *fakeSecurityJSON) ReadSecurityJSON(_ context.Context, _, _, tag string) ([]byte, error) {
	f.lastTag = tag
	return f.raw, f.err
}

func securityJSONThunder(t *testing.T, name, scopes string) []byte {
	t.Helper()
	thunder := map[string]any{"name": name, "type": "browser"}
	if scopes != "" {
		thunder["scopes"] = scopes
	}
	raw, err := json.Marshal(map[string]any{
		"version":          1,
		"coldStartRole":    "Viewer",
		"publicComponents": []string{"web"},
		"roles": []any{map[string]any{
			"name":        "Viewer",
			"description": "Reads own claims.",
			"stories":     []int{1},
			"grantedBy":   "first sign-in",
			"permissions": []any{map[string]any{"component": "api", "actions": []string{"read"}}},
		}},
		"testUsers": []any{map[string]any{"username": "test-viewer", "role": "Viewer"}},
		"thunder":   thunder,
	})
	if err != nil {
		t.Fatalf("marshal security.json fixture: %v", err)
	}
	if _, err := securityspec.Parse(raw); err != nil {
		t.Fatalf("fixture is not a valid security.json: %v", err)
	}
	return raw
}

func designWithThunderApp(params map[string]any) []spec.DesignComponent {
	return []spec.DesignComponent{{
		Name: "web",
		Dependencies: []spec.Dependency{
			{Kind: spec.DependencyKindPlatformResource, Name: "idp", ResourceType: "thunder-app", Parameters: params},
		},
	}}
}

func thunderOverlayService(design []spec.DesignComponent, plat *fakePlatProv, security *fakeSecurityJSON) *Service {
	return NewService(Deps{
		Issues:       newFakeIssues(nil),
		Execs:        &fakeExecStore{},
		Design:       fakeDesign{comps: design},
		Repos:        fakeRepos{},
		PlatProv:     plat,
		Markers:      endUserAuthMarkers(),
		SecurityJSON: security,
	})
}

func TestProvision_ThunderNameOverlaysDisplayName(t *testing.T) {
	plat := &fakePlatProv{}
	sec := &fakeSecurityJSON{raw: securityJSONThunder(t, "Expense Tracker", "")}
	svc := thunderOverlayService(designWithThunderApp(nil), plat, sec)
	if err := svc.Provision(context.Background(), "org", "proj", "idp", nil, nil); err != nil {
		t.Fatalf("Provision: %v", err)
	}
	if plat.calls != 1 {
		t.Fatalf("platform provisioner must be called once, got %d", plat.calls)
	}
	if sec.lastTag != "" {
		t.Fatalf("HTTP provision must read security.json at HEAD (empty tag), got %q", sec.lastTag)
	}
	if got := plat.params["displayName"]; got != "Expense Tracker" {
		t.Fatalf("displayName = %v, want %q", got, "Expense Tracker")
	}
	if _, copied := plat.params["type"]; copied {
		t.Fatalf("thunder.type must not be copied onto CRT params, got %+v", plat.params)
	}
}

func TestProvision_ThunderScopesOverlayWhenAuthored(t *testing.T) {
	const authored = "openid profile email group ou"
	plat := &fakePlatProv{}
	svc := thunderOverlayService(designWithThunderApp(nil), plat, &fakeSecurityJSON{
		raw: securityJSONThunder(t, "Expense Tracker", authored),
	})
	if err := svc.Provision(context.Background(), "org", "proj", "idp", nil, nil); err != nil {
		t.Fatalf("Provision: %v", err)
	}
	if got := plat.params["scopes"]; got != authored {
		t.Fatalf("scopes = %v, want %q", got, authored)
	}
}

func TestProvision_OmittedThunderScopesLeavesScopesAbsent(t *testing.T) {
	plat := &fakePlatProv{}
	svc := thunderOverlayService(designWithThunderApp(nil), plat, &fakeSecurityJSON{
		raw: securityJSONThunder(t, "Expense Tracker", ""),
	})
	if err := svc.Provision(context.Background(), "org", "proj", "idp", nil, nil); err != nil {
		t.Fatalf("Provision: %v", err)
	}
	if got := plat.params["displayName"]; got != "Expense Tracker" {
		t.Fatalf("displayName = %v, want %q (overlay still applies when scopes are omitted)", got, "Expense Tracker")
	}
	if _, present := plat.params["scopes"]; present {
		t.Fatalf("scopes must be absent when thunder omits them, got %+v", plat.params)
	}
}

func TestProvision_DesignJSONScopesCannotWin(t *testing.T) {
	designScopes := map[string]any{"scopes": "openid profile email"}

	t.Run("overlay wins", func(t *testing.T) {
		const authored = "openid profile email group ou"
		plat := &fakePlatProv{}
		svc := thunderOverlayService(designWithThunderApp(designScopes), plat, &fakeSecurityJSON{
			raw: securityJSONThunder(t, "Expense Tracker", authored),
		})
		if err := svc.Provision(context.Background(), "org", "proj", "idp", nil, nil); err != nil {
			t.Fatalf("Provision: %v", err)
		}
		if got := plat.params["scopes"]; got != authored {
			t.Fatalf("design.json parameters.scopes must not win; got %v, want thunder %q", got, authored)
		}
	})

	t.Run("omit wins", func(t *testing.T) {
		plat := &fakePlatProv{}
		svc := thunderOverlayService(designWithThunderApp(designScopes), plat, &fakeSecurityJSON{
			raw: securityJSONThunder(t, "Expense Tracker", ""),
		})
		if err := svc.Provision(context.Background(), "org", "proj", "idp", nil, nil); err != nil {
			t.Fatalf("Provision: %v", err)
		}
		if _, present := plat.params["scopes"]; present {
			t.Fatalf("design.json parameters.scopes must be deleted when thunder omits scopes, got %+v", plat.params)
		}
	})

	t.Run("request params cannot win", func(t *testing.T) {
		const authored = "openid profile email group ou"
		plat := &fakePlatProv{}
		svc := thunderOverlayService(designWithThunderApp(nil), plat, &fakeSecurityJSON{
			raw: securityJSONThunder(t, "Expense Tracker", authored),
		})
		if err := svc.Provision(context.Background(), "org", "proj", "idp", map[string]any{"scopes": "openid profile email"}, nil); err != nil {
			t.Fatalf("Provision: %v", err)
		}
		if got := plat.params["scopes"]; got != authored {
			t.Fatalf("request parameters.scopes must not win; got %v, want thunder %q", got, authored)
		}
	})
}

func TestProvision_NonEndUserAuthParamsUnchanged(t *testing.T) {
	plat := &fakePlatProv{}
	svc := thunderOverlayService(designWithDeps(), plat, &fakeSecurityJSON{
		raw: securityJSONThunder(t, "Expense Tracker", "openid profile email group ou"),
	})
	if err := svc.Provision(context.Background(), "org", "proj", "orders-db", nil, nil); err != nil {
		t.Fatalf("Provision: %v", err)
	}
	if plat.params["size"] != "small" {
		t.Fatalf("existing params must still flow, got %+v", plat.params)
	}
	if _, got := plat.params["displayName"]; got {
		t.Fatalf("non-end-user-auth must not take displayName from security.json, got %+v", plat.params)
	}
	if _, got := plat.params["scopes"]; got {
		t.Fatalf("non-end-user-auth must not take scopes from security.json, got %+v", plat.params)
	}
}

func TestProvision_InvalidSecurityJSONFailsProvision(t *testing.T) {
	plat := &fakePlatProv{}
	svc := thunderOverlayService(designWithThunderApp(nil), plat, &fakeSecurityJSON{
		raw: []byte(`{"not": "a security document"}`),
	})
	if err := svc.Provision(context.Background(), "org", "proj", "idp", nil, nil); err == nil {
		t.Fatal("present-but-invalid security.json must fail provision")
	}
	if plat.calls != 0 {
		t.Fatalf("platform provisioner must not be called on parse error, got %d", plat.calls)
	}
}

func TestProvisionForBuild_ReadsSecurityJSONAtSpecTag(t *testing.T) {
	plat := &fakePlatProv{}
	sec := &fakeSecurityJSON{raw: securityJSONThunder(t, "Expense Tracker", "")}
	svc := thunderOverlayService(designWithThunderApp(nil), plat, sec)
	fails, err := svc.ProvisionForBuild(context.Background(), "org", "org", "proj", "v3", 0, []BuildProvisionInput{
		{Component: "web", Dependency: "idp", Kind: buildKindPlatformResrc},
	})
	if err != nil {
		t.Fatalf("ProvisionForBuild: %v", err)
	}
	if len(fails) != 0 {
		t.Fatalf("want no failures, got %+v", fails)
	}
	if sec.lastTag != "v3" {
		t.Fatalf("build path must read security.json at the spec tag, got %q", sec.lastTag)
	}
	if plat.params["displayName"] != "Expense Tracker" {
		t.Fatalf("displayName = %v, want Expense Tracker", plat.params["displayName"])
	}
}
