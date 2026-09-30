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

// sre_role.go — the rca-agent role actions the stock v1.3.0 SRE agent needs
// on an OpenChoreo 1.2.5 control plane.
//
// The agent's get_resource, list_resource_release_bindings and
// get_resource_release_binding tools are filtered out of its catalog unless
// the caller's role holds resource:view and resourcereleasebinding:view.
// OpenChoreo 1.3.0's chart grants both to rca-agent; 1.2.5's does not. The
// role is a list item in the control-plane chart's bootstrap.roles values,
// which Helm cannot merge into, so `aectl sre install` adds the missing
// actions with a JSON patch. On a 1.3.0 control plane it finds nothing to add.
//
// `aectl sre uninstall` leaves the role alone: aectl cannot tell the actions
// it added from the ones the chart ships.

package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"

	"github.com/wso2/aep/aectl/internal/ui"
)

const (
	rcaAgentRoleAPIVersion = "openchoreo.dev/v1alpha1"
	rcaAgentRoleKind       = "ClusterAuthzRole"
	rcaAgentRoleName       = "rca-agent"
)

// rcaAgentActions are the actions the v1.3.0 agent's tools need beyond what
// OpenChoreo 1.2.5's rca-agent role grants.
var rcaAgentActions = []string{"resource:view", "resourcereleasebinding:view"}

var errRCAAgentRoleNotFound = errors.New("ClusterAuthzRole rca-agent not found")

// roleClient is the slice of *kubernetes.Applier the role step uses, so the
// step can be tested without a cluster.
type roleClient interface {
	Get(ctx context.Context, apiVersion, kind, namespace, name string) (*unstructured.Unstructured, error)
	Patch(ctx context.Context, apiVersion, kind, namespace, name string, patchType types.PatchType, body []byte) error
}

// ensureRCAAgentRole adds whichever of rcaAgentActions the rca-agent role
// lacks, in one JSON patch, and returns the actions it added. A role that
// already holds them all is left untouched.
func ensureRCAAgentRole(ctx context.Context, rc roleClient) ([]string, error) {
	role, err := rc.Get(ctx, rcaAgentRoleAPIVersion, rcaAgentRoleKind, "", rcaAgentRoleName)
	if err != nil {
		return nil, err
	}
	if role == nil {
		return nil, errRCAAgentRoleNotFound
	}
	have, found, err := unstructured.NestedStringSlice(role.Object, "spec", "actions")
	if err != nil {
		return nil, fmt.Errorf("read %s spec.actions: %w", rcaAgentRoleName, err)
	}
	missing := missingActions(have, rcaAgentActions)
	if len(missing) == 0 {
		return nil, nil
	}
	body, err := rcaAgentRolePatch(missing, found)
	if err != nil {
		return nil, err
	}
	if err := rc.Patch(ctx, rcaAgentRoleAPIVersion, rcaAgentRoleKind, "", rcaAgentRoleName, types.JSONPatchType, body); err != nil {
		return nil, err
	}
	return missing, nil
}

// missingActions returns the entries of want that have lacks, in want's order.
func missingActions(have, want []string) []string {
	held := make(map[string]bool, len(have))
	for _, a := range have {
		held[a] = true
	}
	var missing []string
	for _, a := range want {
		if !held[a] {
			missing = append(missing, a)
		}
	}
	return missing
}

// rcaAgentRolePatch is the JSON patch that adds actions to the role: one
// append per action, or the whole list when the role has no actions field.
func rcaAgentRolePatch(actions []string, haveList bool) ([]byte, error) {
	type op struct {
		Op    string `json:"op"`
		Path  string `json:"path"`
		Value any    `json:"value"`
	}
	if !haveList {
		return json.Marshal([]op{{Op: "add", Path: "/spec/actions", Value: actions}})
	}
	ops := make([]op, 0, len(actions))
	for _, a := range actions {
		ops = append(ops, op{Op: "add", Path: "/spec/actions/-", Value: a})
	}
	return json.Marshal(ops)
}

// reportRCAAgentRole prints the role step's outcome. A failure is a warning,
// not an install error: without the actions the agent still completes RCA and
// remediation, it just cannot see Resources or ResourceReleaseBindings.
func reportRCAAgentRole(added []string, err error) {
	switch {
	case err != nil:
		ui.Warn(fmt.Sprintf("Could not add %s to the %s role: %v. "+
			"The SRE agent's get_resource, list_resource_release_bindings and get_resource_release_binding tools stay unavailable, "+
			"so RCA cannot see Resources or ResourceReleaseBindings. To grant them, add any action the role lacks: %s",
			strings.Join(rcaAgentActions, " and "), rcaAgentRoleName, err, rcaAgentRoleManualPatch()))
	case len(added) > 0:
		ui.Detail(fmt.Sprintf("%s += %s", rcaAgentRoleName, strings.Join(added, ", ")))
	default:
		ui.Detail(fmt.Sprintf("%s already covers the SRE agent's tools", rcaAgentRoleName))
	}
}

// rcaAgentRoleManualPatch is the kubectl command an operator runs when aectl
// cannot patch the role itself.
func rcaAgentRoleManualPatch() string {
	body, _ := rcaAgentRolePatch(rcaAgentActions, true)
	return fmt.Sprintf("kubectl patch clusterauthzrole.openchoreo.dev %s --type=json -p '%s'", rcaAgentRoleName, body)
}
