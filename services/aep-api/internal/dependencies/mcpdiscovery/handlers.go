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

package mcpdiscovery

import (
	"context"
	"strings"

	"github.com/wso2/aep/aep-api/internal/dependencies"
	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
)

// Handler is the resource-type-discovery slice of the strict interface: the
// platform-resource-type catalog read (the HTTP transport of the same data the
// list_platform_resource_types MCP tool serves, over the same ResourceTypeLister
// this package owns). The catalog is cluster-global — there is nothing org-scoped
// to filter by — but the operation still sits behind the deny-by-default tenant
// gate like every other one. A nil lister answers 503, mirroring the pre-migration
// RegisterResourceTypes nil guard.
type Handler struct {
	catalog   ResourceTypeLister
	consumers PlatformResourceConsumerLister
}

// NewHandler wires the slice over the resource-type catalog. A nil catalog is a
// supported configuration: the op degrades to 503. The consumers lister is
// likewise nil-safe: it feeds the additive "used by" overlay and, when nil,
// every type simply reports no consumers.
func NewHandler(catalog ResourceTypeLister, consumers PlatformResourceConsumerLister) *Handler {
	return &Handler{catalog: catalog, consumers: consumers}
}

func (h *Handler) ListPlatformResourceTypes(ctx context.Context, _ gen.ListPlatformResourceTypesRequestObject) (gen.ListPlatformResourceTypesResponseObject, error) {
	if h.catalog == nil {
		return nil, apierr.ServiceUnavailable("resource-type catalog is not configured")
	}
	types, err := h.catalog.List(ctx)
	if err != nil {
		// The catalog reads cluster ClusterResourceTypes over OpenChoreo; a
		// failure is an upstream (data-plane) fault, not the caller's.
		return nil, apierr.BadGateway("failed to list platform resource types")
	}
	// "Used by" overlay: derive the calling org's consumers per ResourceType.
	// Additive and best-effort — a nil lister or a scan error degrades to an
	// empty overlay and never fails the (cluster-global) catalog read.
	var consumersByType map[string][]dependencies.ExternalResourceConsumer
	if h.consumers != nil {
		consumersByType, _ = h.consumers.PlatformResourceConsumersByType(ctx, tenant.BoundOrgFromContext(ctx))
	}
	return gen.ListPlatformResourceTypes200JSONResponse(toPlatformResourceTypeDTOs(types, consumersByType)), nil
}

// toPlatformResourceTypeDTOs projects the domain resource types onto the wire
// DTO: the architect-facing fields (name, description, parameters, outputs)
// minus the AEP-internal markers, and merges the per-org "used by" consumers
// keyed case-insensitively on the type name.
func toPlatformResourceTypeDTOs(in []dependencies.PlatformResourceType, consumersByType map[string][]dependencies.ExternalResourceConsumer) []gen.PlatformResourceTypeDTO {
	out := make([]gen.PlatformResourceTypeDTO, 0, len(in))
	for _, t := range in {
		dto := gen.PlatformResourceTypeDTO{
			Name:        t.Name,
			Description: t.Description,
			Parameters:  t.Parameters,
			Outputs:     t.Outputs,
		}
		for _, c := range consumersByType[strings.ToLower(t.Name)] {
			dto.Consumers = append(dto.Consumers, gen.ConsumerDTO{
				ProjectID:     c.ProjectID,
				ComponentName: c.ComponentName,
			})
		}
		out = append(out, dto)
	}
	return out
}
