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

// OrgServiceHit carries the freshly-fetched org-service catalog lookup
// results ComputeDependencyStatus needs for a kind=org-service dependency:
// whether the name is namespace-visible, and (independently) whether it
// exists in the catalog under ANY visibility. Meaningless for every other
// kind — callers pass the zero value when resolving a non-org-service
// dependency.
type OrgServiceHit struct {
	Visible bool
	Exists  bool
}

// ComputeDependencyStatus is the SINGLE authority for a dependency's
// read-time resolution status/reason — the ONLY place the precedence table
// lives. Every caller (artifacts.ArtifactStore's read path, and later the
// build preflight + hard-gate) fetches the resolver-port lookups fresh and
// passes them in; this function never calls a resolver itself, so it stays
// pure and trivially table-testable.
//
//   - registryHit is the rule-2 lookup: whether dep.Name is registered in the
//     org's external-resource registry. Meaningful only for kind=external.
//   - orgSvc carries the rule for kind=org-service: the namespace-visible /
//     exists-any-visibility catalog lookups (the unchanged 4-state model).
//
// `component` and `platform-resource` dependencies are always `resolved`
// here — platform-resource provisioning readiness stays a build-time
// concern, computed elsewhere, never in this function.
//
// External precedence (first match wins — dependency-management migration
// plan lines 93-104):
//
//  1. candidates present (2+)                        → ambiguous
//  2. name found in the org's external-resource registry → resolved (reuse)
//  3. style absent                                   → unresolved / needs-input
//  4. style=rest-api && specPath absent               → unresolved / needs-spec
//  5. style=sdk && package absent                     → unresolved / needs-input
//  6. else                                            → resolved
func ComputeDependencyStatus(dep Dependency, registryHit bool, orgSvc OrgServiceHit) (status, reason string) {
	switch dep.Kind {
	case DependencyKindComponent, DependencyKindPlatformResource:
		return DependencyStatusResolved, ""

	case DependencyKindOrgService:
		if orgSvc.Visible {
			return DependencyStatusResolved, ""
		}
		if orgSvc.Exists {
			return DependencyStatusBlocked, DependencyReasonAccessRequired
		}
		return DependencyStatusUnresolved, DependencyReasonNotFound

	case DependencyKindExternal:
		switch {
		case len(dep.Candidates) >= 2:
			return DependencyStatusAmbiguous, ""
		case registryHit:
			return DependencyStatusResolved, ""
		case dep.Style == "":
			return DependencyStatusUnresolved, DependencyReasonNeedsInput
		case dep.Style == DependencyStyleRestAPI && dep.SpecPath == "":
			return DependencyStatusUnresolved, DependencyReasonNeedsSpec
		case dep.Style == DependencyStyleSDK && dep.Package == "":
			return DependencyStatusUnresolved, DependencyReasonNeedsInput
		default:
			return DependencyStatusResolved, ""
		}

	default:
		// DependencyKind is a closed set (component|org-service|external|
		// platform-resource); an unrecognized kind should never occur. Fail
		// safe to resolved rather than block on something unclassifiable.
		return DependencyStatusResolved, ""
	}
}
