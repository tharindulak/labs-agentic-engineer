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

// TestDesignOrCollabTurn pins the shared gate both mcpForTurn and the
// dispatched TurnRequest.WebSearch flag key off: a design-generate turn or any
// collab room-scoped turn (regardless of useCase) attach; a plain
// requirements-chat/general turn with no room does not.
func TestDesignOrCollabTurn(t *testing.T) {
	cases := []struct {
		name string
		job  turnJob
		want bool
	}{
		{"design-generate, no room", turnJob{useCase: useCaseDesignGenerate}, true},
		{"requirements-chat, collab room", turnJob{useCase: useCaseRequirementsChat, collabRoomID: "spec-o-p"}, true},
		{"general useCase, collab room", turnJob{useCase: useCaseGeneral, collabRoomID: "spec-o-p"}, true},
		{"requirements-chat, no room", turnJob{useCase: useCaseRequirementsChat}, false},
		{"general useCase, no room", turnJob{useCase: useCaseGeneral}, false},
		{"empty useCase, no room", turnJob{}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := designOrCollabTurn(tc.job); got != tc.want {
				t.Errorf("designOrCollabTurn(%+v) = %v, want %v", tc.job, got, tc.want)
			}
		})
	}
}
