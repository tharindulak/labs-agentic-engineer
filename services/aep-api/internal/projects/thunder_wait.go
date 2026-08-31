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

package projects

import (
	"context"
	"fmt"
	"strings"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/platform/k8sname"
	"github.com/wso2/aep/aep-api/internal/platform/ocname"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// ThunderApplicationView is the deploy-wait projection of a ThunderApplication
// CR: the callback URL written on the spec, and whether that generation has
// been observed ready. This package consumes the view; it does not talk to
// Kubernetes.
type ThunderApplicationView struct {
	RedirectURIs       string
	Ready              bool
	Generation         int64
	ObservedGeneration int64
}

// ThunderApplicationReader fetches the ThunderApplication OpenChoreo rendered
// for a Resource name in an environment. (nil, nil) means the CR is not in
// the cluster yet — the wait stays pending. Lookup is by OC labels, not the
// rendered object name (r-<resource>-<env>-<hash8> in the dataplane NS).
type ThunderApplicationReader interface {
	FindByResource(ctx context.Context, resourceName, environment string) (*ThunderApplicationView, error)
}

// ConsumerURLMarker is the projects-owned projection of CRT consumer-URL
// markers the thunder wait keys on. Empty EnvConfig means the type is not a
// consumer-URL type (skip that dep). Path is always set by the app adapter
// (and by tests) when EnvConfig is set — e.g. "/callback".
type ConsumerURLMarker struct {
	EnvConfig string // CRT consumer-url-env-config value, e.g. "redirectUris"
	Path      string // path to append; tests and the app adapter always set this
}

// resourceMarkerCatalog is the CRT marker lookup the wait keys on
// (EnvConfig, never a resourceType name). The app adapter maps CRT
// TypeMarkers onto ConsumerURLMarker at the composition root.
type resourceMarkerCatalog interface {
	MarkersByName(ctx context.Context) (map[string]ConsumerURLMarker, error)
}

// bindingEnvironmentPatcher is the ResourceReleaseBinding env-config write
// the wait uses to register the SPA callback. openchoreo.ResourceClient
// satisfies it; the port stays this one method so the wait does not pull
// the rest of the Resource model.
type bindingEnvironmentPatcher interface {
	PatchBindingEnvironmentConfigs(ctx context.Context, orgID, bindingName string, configs map[string]string) error
}

// SetResourceCatalog wires the CRT marker lookup the thunder wait keys on.
// A nil catalog skips the wait (today's OC-only verdict).
func (s *DeploymentService) SetResourceCatalog(c resourceMarkerCatalog) {
	if s != nil {
		s.catalog = c
	}
}

// SetResourceClient wires the ResourceReleaseBinding env-config patcher.
// A nil client skips the wait.
func (s *DeploymentService) SetResourceClient(c bindingEnvironmentPatcher) {
	if s != nil {
		s.resourceClient = c
	}
}

// SetThunderApplicationReader wires the ThunderApplication CR reader.
// A nil reader skips the wait.
func (s *DeploymentService) SetThunderApplicationReader(r ThunderApplicationReader) {
	if s != nil {
		s.thunder = r
	}
}

// applyThunderWait holds a web-app's deploy verdict at pending until each
// platform-resource whose CRT carries ConsumerURLEnvConfig has the SPA
// callback on the ThunderApplication CR (and that generation is ready).
// OpenChoreo Ready on the web-app binding is not enough: the placeholder
// https://pending.invalid/callback is not deployed.
//
// Nil catalog, resource client, Thunder reader, or store skips the wait.
// Failed and Undeploy verdicts are left alone; pending OC is not consulted.
func (s *DeploymentService) applyThunderWait(ctx context.Context, orgID, projectID, componentName string, summary *openchoreo.ReleaseBindingSummary, st *delivery.ComponentDeploy) error {
	if s == nil || s.catalog == nil || s.resourceClient == nil || s.thunder == nil || s.store == nil {
		return nil
	}
	if summary != nil && summary.Undeploy {
		return nil
	}
	if st == nil || !st.Ready || st.Failed {
		return nil
	}

	design, err := s.store.ReadDesign(ctx, orgID, projectID)
	if err != nil {
		if spec.IsNotFound(err) {
			return nil
		}
		return fmt.Errorf("deployment: thunder wait: read design: %w", err)
	}
	if design == nil {
		return nil
	}
	comp := findDesignComponent(design, componentName)
	if comp == nil || comp.ComponentType != spec.ComponentTypeWebApplication {
		return nil
	}

	var platformDeps []spec.Dependency
	for i := range comp.Dependencies {
		if comp.Dependencies[i].Kind == spec.DependencyKindPlatformResource {
			platformDeps = append(platformDeps, comp.Dependencies[i])
		}
	}
	if len(platformDeps) == 0 {
		return nil
	}

	markers, err := s.catalog.MarkersByName(ctx)
	if err != nil {
		return fmt.Errorf("deployment: thunder wait: catalog: %w", err)
	}

	var consumerDeps []spec.Dependency
	for _, d := range platformDeps {
		if markers[d.ResourceType].EnvConfig != "" {
			consumerDeps = append(consumerDeps, d)
		}
	}
	if len(consumerDeps) == 0 {
		return nil
	}

	origin := strings.TrimRight(s.componentExternalURL(ctx, orgID, projectID, componentName), "/")
	if origin == "" {
		st.Ready = false
		return nil
	}

	matched := true
	for _, dep := range consumerDeps {
		m := markers[dep.ResourceType]
		callback := origin + m.Path
		bindingName := ocname.ExternalResourceBindingName(projectID, dep.Name, openchoreo.DevEnvironmentName)
		if perr := s.resourceClient.PatchBindingEnvironmentConfigs(ctx, orgID, bindingName,
			map[string]string{m.EnvConfig: callback}); perr != nil {
			return fmt.Errorf("deployment: thunder wait: patch callback for %q: %w", dep.Name, perr)
		}
		cr, gerr := s.thunder.FindByResource(ctx, ocname.ExternalResourceName(projectID, dep.Name), openchoreo.DevEnvironmentName)
		if gerr != nil {
			return fmt.Errorf("deployment: thunder wait: find ThunderApplication %q: %w", dep.Name, gerr)
		}
		if !thunderCRSatisfies(cr, callback) {
			matched = false
		}
	}
	if !matched {
		// Pending until the CR matches; forever-pending expires via deploy-budget
		// (TestDeployNeverReady_ExpiresIntoADeployFailure) — no workflow rewrite.
		st.Ready = false
	}
	return nil
}

func thunderCRSatisfies(cr *ThunderApplicationView, callback string) bool {
	if cr == nil {
		return false
	}
	return cr.RedirectURIs == callback && cr.Ready && cr.ObservedGeneration >= cr.Generation
}

// componentExternalURL returns the first non-empty EndpointURL OC has
// resolved for the named component, or "" when none is materialised yet.
// Same source as runtimeconfig.componentExternalURL.
func (s *DeploymentService) componentExternalURL(ctx context.Context, orgID, projectID, componentName string) string {
	if s.components == nil {
		return ""
	}
	list, err := s.components.ListDeployments(ctx, orgID, projectID, k8sname.ToK8sName(componentName))
	if err != nil || list == nil {
		return ""
	}
	for _, d := range list.Items {
		if d.EndpointURL != "" {
			return d.EndpointURL
		}
	}
	return ""
}
