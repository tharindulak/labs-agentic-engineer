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
	"errors"
	"strconv"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

// labelsAfter is the issue's label set as the host now holds it: the set the
// route was handed, plus every label it added, minus every one it removed.
//
// Self-arming is only correct as a property of that SET — every consumer
// downstream of adoption (delivery.InTaskWorkingSet, the milestone counts, the
// reconcile sweep) reads the issue's labels, not this package's writes — so the
// tests below assert the set rather than the individual calls.
func labelsAfter(f *fakeIssues, number int, before ...string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := append([]string(nil), before...)
	for _, write := range f.labelled {
		if name, ok := strings.CutPrefix(write, strconv.Itoa(number)+"+"); ok {
			if !delivery.HasLabel(out, name) {
				out = append(out, name)
			}
			continue
		}
		if name, ok := strings.CutPrefix(write, strconv.Itoa(number)+"-"); ok {
			kept := out[:0]
			for _, have := range out {
				if !strings.EqualFold(have, name) {
					kept = append(kept, have)
				}
			}
			out = kept
		}
	}
	return out
}

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

// TestAutoAdoptUserBug_ArmsTheIssueItAdopts is the property the milestone move
// and the started run cannot express between them: the run picks its work out of
// the milestone through delivery.InTaskWorkingSet, which gates on the ARMING
// label first. An issue adopted without it is a ledger issue by the platform's
// own definition — the run's first boundary poll counts no work, parks
// indefinitely, and holds the milestone's one live-run slot while it does.
func TestAutoAdoptUserBug_ArmsTheIssueItAdopts(t *testing.T) {
	h := newHarness(t, aRun("run-old", 5, delivery.RunStateSucceeded))

	h.events.AutoAdoptUserBug(context.Background(), testOrg, testProject,
		AdoptTarget{Number: 31, Labels: []string{delivery.KindBug}})

	after := labelsAfter(h.issues, 31, delivery.KindBug)
	if !delivery.InTaskWorkingSet(after) {
		t.Fatalf("the adopted issue must be in the task run's working set, got labels %v", after)
	}
	if len(h.sup.started) != 1 {
		t.Fatalf("must start exactly one task run, got %+v", h.sup.started)
	}
}

// TestAutoAdoptUserBug_RefusesToAdoptWhenArmingFails: arming and adopting are one
// act. With the label write failing, adopting anyway is precisely the broken
// state — an issue in the deployed milestone that no working set can see, plus a
// run parked on it — so nothing else may be written.
//
// It also pins the ORDER, which two separately recorded writes otherwise cannot
// show: the arming stamp goes first, because the run AdoptIssue starts polls its
// milestone at the first cycle boundary and the platform's own label write comes
// back echo-suppressed. A stamp that lands after that poll is a stamp no run sees.
func TestAutoAdoptUserBug_RefusesToAdoptWhenArmingFails(t *testing.T) {
	h := newHarness(t, aRun("run-old", 5, delivery.RunStateSucceeded))
	h.issues.labelErr = errors.New("github: 502")

	h.events.AutoAdoptUserBug(context.Background(), testOrg, testProject,
		AdoptTarget{Number: 31, Labels: []string{delivery.KindBug}})

	if len(h.issues.assigned) != 0 || len(h.sup.started) != 0 {
		t.Fatalf("must adopt nothing when arming failed, got assigned=%v started=%+v",
			h.issues.assigned, h.sup.started)
	}
	if body, ok := h.issues.commentBodies[31]; ok {
		t.Fatalf("must not claim an issue was armed when it was not, got %q", body)
	}
}

// TestAutoAdoptUserBug_NoDeployedVersionLeavesTheIssueUnarmed: the one adoption
// outcome that writes nothing rolls the arming stamp back with it.
//
// Leaving it on would arm an issue in NO milestone — invisible to every working
// set and to the reconcile sweep, which walks milestones — and would silently
// falsify the comment's own advice: re-adding `bug` cannot self-arm an issue that
// already carries `aep` (eligibleForAutoAdopt).
func TestAutoAdoptUserBug_NoDeployedVersionLeavesTheIssueUnarmed(t *testing.T) {
	h := newHarness(t) // no runs at all — nothing has ever deployed

	h.events.AutoAdoptUserBug(context.Background(), testOrg, testProject,
		AdoptTarget{Number: 31, Labels: []string{delivery.KindBug}})

	after := labelsAfter(h.issues, 31, delivery.KindBug)
	if delivery.HasLabel(after, delivery.LabelAgentWork) {
		t.Fatalf("an issue nothing adopted must be left unarmed, got labels %v", after)
	}
	if !eligibleForAutoAdopt(after) {
		t.Fatalf("the comment tells the reporter to re-add `bug` once a version deploys — "+
			"that has to still self-arm, but %v is no longer eligible", after)
	}
}

// TestAutoAdoptUserBug_RollbackFailureIsReturnedNotSwallowed: the ONE error
// this route does not swallow. If the rollback's own Unlabel fails, the issue
// is left armed in no milestone — and posting the "no deployed version"
// comment now would tell the reporter to add `aep` directly, which is
// already there. Returning the error lets the caller fail the webhook
// delivery so GitHub's redelivery retries the same idempotent unlabel.
func TestAutoAdoptUserBug_RollbackFailureIsReturnedNotSwallowed(t *testing.T) {
	h := newHarness(t) // no runs at all — nothing has ever deployed
	h.issues.unlabelErr = errors.New("github: 502")

	err := h.events.AutoAdoptUserBug(context.Background(), testOrg, testProject,
		AdoptTarget{Number: 31, Labels: []string{delivery.KindBug}})

	if err == nil {
		t.Fatal("a failed rollback must be returned, not swallowed")
	}
	if _, ok := h.issues.commentBodies[31]; ok {
		t.Fatalf("must not post a comment whose advice is already false, got %q", h.issues.commentBodies[31])
	}
	after := labelsAfter(h.issues, 31, delivery.KindBug)
	if !delivery.HasLabel(after, delivery.LabelAgentWork) {
		t.Fatalf("the failed unlabel must leave the issue exactly as it was — still armed, got %v", after)
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
