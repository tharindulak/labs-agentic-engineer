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

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/dependencies"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// ExternalResourceView is one org external-resource catalog entry with its
// config schema and current consumers (the in-use delete guard input). Values
// are never included — the catalog holds schema + references only.
type ExternalResourceView struct {
	Name        string
	Description string
	Config      []spec.ConfigKey
	Consumers   []dependencies.ExternalResourceConsumer
}

// ListExternalResources returns the org's external-resource catalog with each
// entry's consumers (the components across the org whose committed design
// declares an external dependency of that name — a design scan, since the
// upstream component_tasks table is gone). Definitions are sourced from the
// org's namespaced OpenChoreo ResourceTypes via rtCatalog (Slice 3's
// resources.ExternalResourceCatalog, reconstructed off each authored RT and
// deduped to the newest schema-version RT per name) — never the
// external_resources table (s.catalog is no longer read anywhere in this
// package; authoring now builds its definition off the design — see
// build_provision.go / value_service.go).
func (s *Service) ListExternalResources(ctx context.Context, orgID string) ([]ExternalResourceView, error) {
	defs, err := s.rtCatalog.List(ctx, orgID)
	if err != nil {
		return nil, fmt.Errorf("provisioning: list external resources: %w", err)
	}
	consumersByName, err := s.externalConsumersByName(ctx, orgID)
	if err != nil {
		return nil, err
	}
	out := make([]ExternalResourceView, 0, len(defs))
	for i := range defs {
		def := &defs[i]
		out = append(out, ExternalResourceView{
			Name:        def.Name,
			Description: def.Description,
			Config:      toConfigKeys(def.Config),
			Consumers:   consumersByName[strings.ToLower(def.Name)],
		})
	}
	return out, nil
}

// toConfigKeys adapts the OC client's leaf-level config-key type (kept
// import-free of spec by design — see openchoreo.ExternalResourceConfigKey's
// doc) to the spec.ConfigKey the ExternalResourceDTO wire shape carries.
// Field-for-field identical; this is purely a package boundary crossing.
func toConfigKeys(keys []openchoreo.ExternalResourceConfigKey) []spec.ConfigKey {
	out := make([]spec.ConfigKey, 0, len(keys))
	for _, k := range keys {
		out = append(out, spec.ConfigKey{
			Key:          k.Key,
			Secret:       k.Secret,
			Description:  k.Description,
			DefaultValue: k.DefaultValue,
		})
	}
	return out
}

// DeleteExternalResource removes an org external-resource catalog entry —
// every namespaced OpenChoreo ResourceType registered under this logical name
// (rtCatalog.Delete; more than one schema-version RT can carry the same name —
// see openchoreo.ExternalResourceRTName). It is guarded: a resource with
// consumers returns ErrExternalResourceInUse (→ 409) and NO ResourceType is
// deleted — the design-sweep guard runs BEFORE the OC delete call.
func (s *Service) DeleteExternalResource(ctx context.Context, orgID, name string) error {
	consumers, err := s.consumersOf(ctx, orgID, name)
	if err != nil {
		return fmt.Errorf("provisioning: check consumers of %q: %w", name, err)
	}
	if len(consumers) > 0 {
		return ErrExternalResourceInUse
	}
	if err := s.rtCatalog.Delete(ctx, orgID, name); err != nil {
		return fmt.Errorf("provisioning: delete external resource %q: %w", name, err)
	}
	return nil
}

// consumersOf scans every project's committed design for components declaring an
// `external` dependency of the given name. Best-effort per project (a design read
// error skips that project). Returns nil when no project lister is wired.
func (s *Service) consumersOf(ctx context.Context, orgID, externalName string) ([]dependencies.ExternalResourceConsumer, error) {
	byName, err := s.externalConsumersByName(ctx, orgID)
	if err != nil {
		return nil, err
	}
	return byName[strings.ToLower(externalName)], nil
}

// externalConsumersByName builds, in one project sweep, the consumers of every
// external dependency name in the org (lowercased name → consumers). One sweep
// serves both the list (all entries) and a single-name delete guard.
func (s *Service) externalConsumersByName(ctx context.Context, orgID string) (map[string][]dependencies.ExternalResourceConsumer, error) {
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
				if d.Kind != spec.DependencyKindExternal {
					continue
				}
				key := strings.ToLower(d.Name)
				out[key] = append(out[key], dependencies.ExternalResourceConsumer{
					ProjectID:     ref.ProjectID,
					ComponentName: c.Name,
				})
			}
		}
	}
	return out, nil
}
