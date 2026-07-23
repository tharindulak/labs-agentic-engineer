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

package spec

import "testing"

// TestComputeDependencyStatus is the single table test for the precedence
// table ComputeDependencyStatus owns — every external state, precedence
// ordering (including the registry-reuse rule beating every later rule), and
// the org-service 4-state regression (pinned here directly as a pure-function
// test; artifacts.resolveOrgServices' own tests pin the same outcomes through
// the read path unchanged).
func TestComputeDependencyStatus(t *testing.T) {
	twoCandidates := []DependencyCandidate{
		{Name: "sendgrid-rest", Style: DependencyStyleRestAPI},
		{Name: "resend-sdk", Style: DependencyStyleSDK},
	}

	cases := []struct {
		name        string
		dep         Dependency
		registryHit bool
		orgSvc      OrgServiceHit
		wantStatus  string
		wantReason  string
	}{
		// --- component / platform-resource: always resolved -----------------
		{
			name:       "component kind is always resolved",
			dep:        Dependency{Kind: DependencyKindComponent, Name: "cart"},
			wantStatus: DependencyStatusResolved,
		},
		{
			name: "platform-resource kind is always resolved regardless of resourceType",
			dep: Dependency{Kind: DependencyKindPlatformResource, Name: "orders-db",
				ResourceType: "postgres-cnpg"},
			wantStatus: DependencyStatusResolved,
		},

		// --- org-service: unchanged 4-state model ----------------------------
		{
			name:       "org-service namespace-visible resolves regardless of exists",
			dep:        Dependency{Kind: DependencyKindOrgService, Name: "employee-api"},
			orgSvc:     OrgServiceHit{Visible: true, Exists: false},
			wantStatus: DependencyStatusResolved,
		},
		{
			name:       "org-service project-only (exists, not namespace-visible) is blocked/access-required",
			dep:        Dependency{Kind: DependencyKindOrgService, Name: "payroll-internal"},
			orgSvc:     OrgServiceHit{Visible: false, Exists: true},
			wantStatus: DependencyStatusBlocked,
			wantReason: DependencyReasonAccessRequired,
		},
		{
			name:       "org-service absent from the catalog is unresolved/not-found",
			dep:        Dependency{Kind: DependencyKindOrgService, Name: "ghost-svc"},
			orgSvc:     OrgServiceHit{},
			wantStatus: DependencyStatusUnresolved,
			wantReason: DependencyReasonNotFound,
		},

		// --- external: precedence order (first match wins) -------------------
		{
			name: "rule 1: 2+ candidates is ambiguous, even with a registry hit",
			dep: Dependency{Kind: DependencyKindExternal, Name: "email-provider",
				Candidates: twoCandidates},
			registryHit: true,
			wantStatus:  DependencyStatusAmbiguous,
		},
		{
			name:        "rule 2: registry reuse resolves with no style at all",
			dep:         Dependency{Kind: DependencyKindExternal, Name: "stripe"},
			registryHit: true,
			wantStatus:  DependencyStatusResolved,
		},
		{
			name: "rule 2: registry reuse resolves ahead of rule 4 (rest-api, no specPath)",
			dep: Dependency{Kind: DependencyKindExternal, Name: "stripe",
				Style: DependencyStyleRestAPI},
			registryHit: true,
			wantStatus:  DependencyStatusResolved,
		},
		{
			name: "rule 2: registry reuse resolves ahead of rule 5 (sdk, no package)",
			dep: Dependency{Kind: DependencyKindExternal, Name: "stripe",
				Style: DependencyStyleSDK},
			registryHit: true,
			wantStatus:  DependencyStatusResolved,
		},
		{
			name:       "rule 3: no style is unresolved/needs-input",
			dep:        Dependency{Kind: DependencyKindExternal, Name: "stripe"},
			wantStatus: DependencyStatusUnresolved,
			wantReason: DependencyReasonNeedsInput,
		},
		{
			name: "rule 4: rest-api with no specPath is unresolved/needs-spec",
			dep: Dependency{Kind: DependencyKindExternal, Name: "stripe",
				Style: DependencyStyleRestAPI},
			wantStatus: DependencyStatusUnresolved,
			wantReason: DependencyReasonNeedsSpec,
		},
		{
			name: "rest-api WITH specPath resolves",
			dep: Dependency{Kind: DependencyKindExternal, Name: "stripe",
				Style: DependencyStyleRestAPI, SpecPath: "dependencies/stripe.openapi.yaml"},
			wantStatus: DependencyStatusResolved,
		},
		{
			name: "rule 5: sdk with no package is unresolved/needs-input",
			dep: Dependency{Kind: DependencyKindExternal, Name: "stripe",
				Style: DependencyStyleSDK},
			wantStatus: DependencyStatusUnresolved,
			wantReason: DependencyReasonNeedsInput,
		},
		{
			name: "sdk WITH package resolves",
			dep: Dependency{Kind: DependencyKindExternal, Name: "stripe",
				Style: DependencyStyleSDK, Package: "npm:stripe@^14"},
			wantStatus: DependencyStatusResolved,
		},

		// --- defensive default ------------------------------------------------
		{
			name:       "an unrecognized kind fails safe to resolved",
			dep:        Dependency{Kind: "bogus-kind", Name: "mystery"},
			wantStatus: DependencyStatusResolved,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotStatus, gotReason := ComputeDependencyStatus(tc.dep, tc.registryHit, tc.orgSvc)
			if gotStatus != tc.wantStatus || gotReason != tc.wantReason {
				t.Errorf("ComputeDependencyStatus(%+v, registryHit=%v, %+v) = (%q, %q), want (%q, %q)",
					tc.dep, tc.registryHit, tc.orgSvc, gotStatus, gotReason, tc.wantStatus, tc.wantReason)
			}
		})
	}
}
