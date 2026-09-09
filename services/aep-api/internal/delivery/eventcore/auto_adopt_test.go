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

package eventcore

import (
	"context"
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

func TestEligibleForAutoAdopt(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		labels []string
		want   bool
	}{
		{"unarmed user bug, no source label", []string{delivery.KindBug}, true},
		{"unarmed, explicit src/user", []string{delivery.KindBug, delivery.SrcUser}, true},
		{"already armed by a human", []string{delivery.LabelAgentWork, delivery.KindBug}, false},
		{"incident-sourced", []string{delivery.KindBug, delivery.SrcIncident}, false},
		{"build-sourced", []string{delivery.KindBug, delivery.SrcBuild}, false},
		{"not a bug at all", []string{delivery.KindDevelopment}, false},
		{"a ledger issue with no labels", nil, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := eligibleForAutoAdopt(c.labels); got != c.want {
				t.Errorf("eligibleForAutoAdopt(%v) = %v, want %v", c.labels, got, c.want)
			}
		})
	}
}

func TestAutoAdoptUserBug_AdoptsAndLeavesTheAuditComment(t *testing.T) {
	h := newHarness(t, aRun("run-old", 5, delivery.RunStateSucceeded))

	h.events.AutoAdoptUserBug(context.Background(), testOrg, testProject,
		AdoptTarget{Number: 31, Labels: []string{delivery.KindBug}})

	if len(h.issues.assigned) != 1 || h.issues.assigned[0] != "31->5" {
		t.Fatalf("must join the deployed version's milestone, got %v", h.issues.assigned)
	}
	if len(h.sup.started) != 1 || h.sup.started[0].Kind != delivery.RunKindTask {
		t.Fatalf("must start a task run, got %+v", h.sup.started)
	}
	if got := h.issues.commentBodies[31]; got != autoAdoptedComment {
		t.Fatalf("must leave the auto-adopted audit comment, got %q", got)
	}
}

func TestAutoAdoptUserBug_NoDeployedVersionLeavesAnExplanation(t *testing.T) {
	h := newHarness(t) // no runs at all — nothing has ever deployed

	h.events.AutoAdoptUserBug(context.Background(), testOrg, testProject,
		AdoptTarget{Number: 31, Labels: []string{delivery.KindBug}})

	if len(h.issues.assigned) != 0 || len(h.sup.started) != 0 {
		t.Fatalf("must adopt nothing without a deployed version, got assigned=%v started=%+v",
			h.issues.assigned, h.sup.started)
	}
	if got := h.issues.commentBodies[31]; got != autoAdoptNoDeployedVersionComment {
		t.Fatalf("must explain why it did not adopt, got %q", got)
	}
}
