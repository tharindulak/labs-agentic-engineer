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

package run

import (
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

// A cycle can end because its work was RESOLVED rather than merged: the coding
// agent read the acceptance criteria, concluded no code change could help, and
// closed the issue as `not_planned` (ADR-0023).
//
// Before this, that agent was indistinguishable from a dead one. It exited
// having done the right thing, the cycle sat until cycleLandingTimeout, the
// supervisor spent a re-dispatch, a second agent reached the same conclusion,
// and the run failed with `redispatch-budget` — reporting agent failure for an
// agent that was correct. Roughly four hours to reach a wrong answer.

// factsNeverLandNoWork: the cycle record never learns a merge, because there
// never was one.
func (h *harness) noMergeEver() {
	h.set["facts"] = true
	h.env.OnActivity(h.acts.ReadCycleFacts, mock.Anything, mock.Anything).
		Return(CycleFacts{CycleID: testCycleID}, nil)
}

// THE PROPERTY. Work resolved without a merge settles the run on its FIRST
// dispatch, with no re-dispatch spent and no failure reason.
func TestNoWork_ResolvedWorkSettlesTheRunWithoutSpendingARedispatch(t *testing.T) {
	h := newHarness(t)
	h.milestoneIs(
		// One incident issue: armed, carrying no planned-work kind, so it counts
		// in BOTH working sets — which is what an adopted incident looks like.
		MilestoneSnapshot{DevWork: 1, TaskWork: 1, Total: 1},
		MilestoneSnapshot{}, // the agent closed it: nothing left
	)
	h.noMergeEver()
	h.signal(delivery.SigRunNoWork, time.Second)

	h.runWith(RunInput{Origin: delivery.RunOriginIncidentAdoption})
	res := h.result(t)

	h.assertSettled(t, res, delivery.RunStateSucceeded, "")
	require.Equal(t, 1, h.dispatchCount(),
		"resolving the work is not agent death — no second agent should be sent")
	require.NotEqual(t, delivery.RunReasonRedispatchBudget, h.settle.Reason,
		"an agent that correctly found nothing to change must never be reported as one that died")
	require.Equal(t, "", h.finishes[0].MergeSHA, "nothing was merged, and the cycle must say so")
}

// THE RACE. A merge empties the working set too. If both arrive, the merge is
// the truth — the cycle record decides, not the signal.
func TestNoWork_AMergeStillWinsWhenBothArrive(t *testing.T) {
	h := newHarness(t)
	h.milestoneIs(
		MilestoneSnapshot{DevWork: 1, TaskWork: 1, Total: 1},
		MilestoneSnapshot{},
	)
	// The cycle record HAS a merge — the working set emptied because the pull
	// request landed, not because the work was written off.
	h.mergesAt(testMergeSHA)
	h.signal(delivery.SigRunNoWork, time.Second)

	h.runWith(RunInput{Origin: delivery.RunOriginIncidentAdoption})
	res := h.result(t)

	h.assertSettled(t, res, delivery.RunStateSucceeded, "")
	require.Equal(t, testMergeSHA, h.finishes[0].MergeSHA,
		"the cycle landed a merge and must be recorded as landing it, not as work that vanished")
}

// Without the signal, an agent that produces nothing still spends its budget and
// still ends as agent death. The new path must not have softened that.
func TestNoWork_AnAgentThatSimplyProducesNothingIsStillAgentDeath(t *testing.T) {
	h := newHarness(t)
	h.milestoneIs(MilestoneSnapshot{DevWork: 1, Total: 1})
	h.noMergeEver()

	h.runWith(RunInput{Origin: delivery.RunOriginSpecBuild})
	res := h.result(t)

	h.assertSettled(t, res, delivery.RunStateFailed, delivery.RunReasonRedispatchBudget)
	require.Equal(t, delivery.RunMaxRedispatchPerCycle, h.dispatchCount())
}
