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
	"fmt"
	"strings"

	"github.com/wso2/aep/aep-api/internal/dependencies"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// PlatformResourceConsumersByType scans every org project's committed design
// (one sweep) for components declaring a `platform-resource` dependency,
// grouping the resulting consumers by the dependency's ResourceType (the
// installed ClusterResourceType name), lowercased. It is the platform-resource
// mirror of externalConsumersByName: same ProjectLister + DesignReader sweep,
// same best-effort per-project skip, but keyed on ResourceType (a
// catalog-picked value) rather than the free-text external Name.
//
// The org's org-scoped scan is deliberately kept OUT of
// dependencies/resources.ResourceTypeCatalog — that catalog is cluster-global
// discovery (no org, no projects) shared by the MCP list_platform_resource_types
// tool, which must never carry per-org consumer data. This service already
// holds the ProjectLister + DesignReader ports for the identical external-
// resource scan, so reusing them here avoids wiring a second, redundant
// project/design sweep onto the catalog.
func (s *Service) PlatformResourceConsumersByType(ctx context.Context, orgID string) (map[string][]dependencies.ExternalResourceConsumer, error) {
	out := map[string][]dependencies.ExternalResourceConsumer{}
	if s.projects == nil {
		return out, nil
	}
	refs, err := s.projects.ListProjects(ctx, orgID)
	if err != nil {
		return nil, fmt.Errorf("provisioning: list projects: %w", err)
	}
	for _, ref := range refs {
		comps, derr := s.design.ReadDesignComponents(ctx, ref.OrgID, ref.ProjectID)
		if derr != nil {
			continue // best-effort: a project without a readable design has no consumers
		}
		for _, c := range comps {
			for _, d := range c.Dependencies {
				if d.Kind != spec.DependencyKindPlatformResource {
					continue
				}
				key := strings.ToLower(d.ResourceType)
				out[key] = append(out[key], dependencies.ExternalResourceConsumer{
					ProjectID:     ref.ProjectID,
					ComponentName: c.Name,
				})
			}
		}
	}
	return out, nil
}
