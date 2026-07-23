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
	"errors"
	"testing"

	"github.com/wso2/aep/aep-api/internal/spec"
)

// fakeProjectDesign is a per-project DesignReader fake (unlike fakeDesign,
// which always returns the same components regardless of project) — the
// cross-project platform-resource consumer scan needs a distinct component
// set per project, plus the ability to simulate an unreadable project.
type fakeProjectDesign struct {
	byProject map[string][]spec.DesignComponent
	errFor    map[string]error
}

func (f fakeProjectDesign) ReadDesignComponents(_ context.Context, _, projectID string) ([]spec.DesignComponent, error) {
	if err, ok := f.errFor[projectID]; ok {
		return nil, err
	}
	return f.byProject[projectID], nil
}

// erroringProjectLister simulates a total failure to enumerate org projects
// (distinct from a single unreadable project's design).
type erroringProjectLister struct{ err error }

func (f erroringProjectLister) ListProjects(context.Context, string) ([]ProjectRef, error) {
	return nil, f.err
}

func TestPlatformResourceConsumersByType(t *testing.T) {
	design := fakeProjectDesign{
		byProject: map[string][]spec.DesignComponent{
			"shop": {
				{Name: "orders", Dependencies: []spec.Dependency{
					{Kind: spec.DependencyKindPlatformResource, Name: "orders-db", ResourceType: "postgres-cnpg"},
					// An external dep of the same org must never leak into the
					// platform-resource consumer grouping.
					{Kind: spec.DependencyKindExternal, Name: "stripe"},
				}},
				{Name: "cache-svc", Dependencies: []spec.Dependency{
					{Kind: spec.DependencyKindPlatformResource, Name: "cache", ResourceType: "redis-cnpg"},
				}},
			},
			"billing": {
				{Name: "invoices", Dependencies: []spec.Dependency{
					// Mixed-case resourceType must still group with "postgres-cnpg".
					{Kind: spec.DependencyKindPlatformResource, Name: "invoices-db", ResourceType: "Postgres-CNPG"},
				}},
			},
		},
		errFor: map[string]error{"broken": errors.New("design read failed")},
	}
	svc := NewService(Deps{
		Design: design,
		Projects: fakeProjects{refs: []ProjectRef{
			{OrgID: "acme", ProjectID: "shop"},
			{OrgID: "acme", ProjectID: "billing"},
			{OrgID: "acme", ProjectID: "broken"},    // unreadable: best-effort skip, not fatal
			{OrgID: "other-org", ProjectID: "shop"}, // different org: excluded by ListProjects filter
		}},
	})

	got, err := svc.PlatformResourceConsumersByType(context.Background(), "acme")
	if err != nil {
		t.Fatalf("PlatformResourceConsumersByType: %v", err)
	}

	pg := got["postgres-cnpg"]
	if len(pg) != 2 {
		t.Fatalf("want 2 postgres-cnpg consumers (across projects, case-insensitive), got %+v", pg)
	}
	wantPG := map[string]string{"shop": "orders", "billing": "invoices"}
	for _, c := range pg {
		if wantPG[c.ProjectID] != c.ComponentName {
			t.Errorf("unexpected postgres-cnpg consumer %+v, want one of %v", c, wantPG)
		}
	}

	rc := got["redis-cnpg"]
	if len(rc) != 1 || rc[0].ProjectID != "shop" || rc[0].ComponentName != "cache-svc" {
		t.Fatalf("redis-cnpg consumers = %+v", rc)
	}

	// The external dep (stripe) must not appear under any platform-resource key.
	for typeName, consumers := range got {
		for _, c := range consumers {
			if c.ComponentName == "orders" && typeName != "postgres-cnpg" {
				t.Fatalf("external dep leaked into platform-resource grouping under %q: %+v", typeName, c)
			}
		}
	}
	if len(got) != 2 {
		t.Fatalf("want exactly 2 resource-type groups (postgres-cnpg, redis-cnpg), got %+v", got)
	}
}

// A nil ProjectLister (the feature unwired) yields an empty map, not an error —
// mirrors externalConsumersByName's nil guard.
func TestPlatformResourceConsumersByType_NilProjectLister(t *testing.T) {
	svc := NewService(Deps{})
	got, err := svc.PlatformResourceConsumersByType(context.Background(), "acme")
	if err != nil {
		t.Fatalf("PlatformResourceConsumersByType: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("want an empty map, got %+v", got)
	}
}

// A total failure to enumerate org projects (distinct from a single unreadable
// project) is a genuine error, surfaced to the caller.
func TestPlatformResourceConsumersByType_ListProjectsError(t *testing.T) {
	svc := NewService(Deps{Projects: erroringProjectLister{err: errors.New("db down")}})
	if _, err := svc.PlatformResourceConsumersByType(context.Background(), "acme"); err == nil {
		t.Fatal("want the ListProjects error surfaced")
	}
}

// No platform-resource dependencies anywhere in the org yields an empty map.
func TestPlatformResourceConsumersByType_NoConsumers(t *testing.T) {
	svc := NewService(Deps{
		Design:   fakeProjectDesign{byProject: map[string][]spec.DesignComponent{"shop": {{Name: "web"}}}},
		Projects: fakeProjects{refs: []ProjectRef{{OrgID: "acme", ProjectID: "shop"}}},
	})
	got, err := svc.PlatformResourceConsumersByType(context.Background(), "acme")
	if err != nil {
		t.Fatalf("PlatformResourceConsumersByType: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("want an empty map, got %+v", got)
	}
}
