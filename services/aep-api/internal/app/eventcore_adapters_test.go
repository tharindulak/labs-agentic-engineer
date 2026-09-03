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

package app

import (
	"context"
	"slices"
	"testing"

	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// adopterFunc adapts a plain function onto sourcecontrol.Adopter so a test can
// supply the one call it wants without a hand-rolled struct.
type adopterFunc func(context.Context, string, string, string, sourcecontrol.CreateIssueRequest) (*sourcecontrol.Adoption, error)

func (f adopterFunc) CreateAndAdopt(
	ctx context.Context, orgID, projectID, componentName string, req sourcecontrol.CreateIssueRequest,
) (*sourcecontrol.Adoption, error) {
	return f(ctx, orgID, projectID, componentName, req)
}

// TestEscalationLabelsMatchTheHandoffSet pins the label set both routes into
// the adopter must produce.
//
// The two routes are the REST create-issue path (an SRE agent filing through
// aep-mcp-server) and this escalator. They must be indistinguishable: aep-api's
// recurrence lookup filters on LabelSREAgent, so an issue filed by one route
// without it drops out of recurrence detection and a real recurrence reads as a
// first filing. The MCP server carries the only copy Go cannot share; its
// HANDOFF_LABELS must equal this.
func TestEscalationLabelsMatchTheHandoffSet(t *testing.T) {
	var got sourcecontrol.CreateIssueRequest
	esc := opsIssueEscalator{adopter: adopterFunc(func(
		_ context.Context, _, _, _ string, req sourcecontrol.CreateIssueRequest,
	) (*sourcecontrol.Adoption, error) {
		got = req
		return &sourcecontrol.Adoption{Issue: &sourcecontrol.IssueResult{Number: 1}}, nil
	})}

	if _, err := esc.FileAndDispatch(context.Background(), "org", "proj", "svc", "t", "b", "k"); err != nil {
		t.Fatalf("FileAndDispatch: %v", err)
	}

	want := []string{"bug", sourcecontrol.LabelSREAgent}
	if !slices.Equal(got.Labels, want) {
		t.Errorf("labels = %v, want %v", got.Labels, want)
	}
}
