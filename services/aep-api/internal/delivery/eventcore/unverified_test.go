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
	"reflect"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// The confidence declaration no longer decides WHETHER an incident fix merges —
// it decides whether the issue behind it closes (ADR-0022). Holding the merge
// was tried and withdrawn: it demanded a regression test in a repo with no test
// harness, so it fired on every fix and stopped discriminating.

func withIncidentWork(f *fakeIssues, milestone int, numbers ...int) *fakeIssues {
	for _, n := range numbers {
		f.byMilestone[milestone] = append(f.byMilestone[milestone], sourcecontrol.IssueInfo{
			Number: n, State: "open",
			Labels: []string{delivery.LabelAgentWork, sourcecontrol.LabelSREAgent},
		})
	}
	return f
}

// A low-confidence incident fix MERGES. Nothing waits for a human any more.
func TestIncidentPR_LowConfidenceStillMerges(t *testing.T) {
	h := newHarness(t, aRun("run-1", 7, delivery.RunStateRunning))
	h.cycles.latest = aCycle("cycle-1", "run-1")
	withIncidentWork(h.issues, 7, 40)

	if err := h.deliver(t, "pull_request",
		prBody("opened", "aep/m7-c1", "Resolves #40\n\nConfidence: low", 42, false, false, "")); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if len(h.merger.merged) != 1 {
		t.Fatalf("merged %v; a low-confidence fix must still merge — the issue carries the doubt, not the queue",
			h.merger.merged)
	}
}

// THE POINT OF THE DESIGN. The merge closed the issue via GitHub's keyword; the
// platform undoes exactly that, and takes `aep` off so no run ever works it
// again. Open, on the version's record, worked by nobody.
func TestUnverifiedMerge_ReopensTheIssueAndTakesItOutOfTheWorkingSet(t *testing.T) {
	h := newHarness(t, aRun("run-1", 7, delivery.RunStateRunning))
	h.cycles.latest = aCycle("cycle-1", "run-1")
	h.issues.withIssueState(40, "closed", delivery.LabelAgentWork, sourcecontrol.LabelSREAgent)

	if err := h.deliver(t, "pull_request",
		prBody("closed", "aep/m7-c1", "Resolves #40\n\nConfidence: low", 42, false, true, "abc123")); err != nil {
		t.Fatalf("deliver: %v", err)
	}

	// Order is the contract: the label comes off BEFORE the reopen. Reopening
	// first would briefly present an open `aep` issue to the dispatch predicate,
	// and a run at a cycle boundary in that window dispatches an agent onto work
	// that has already merged.
	want := []string{"unlabel:40:aep", "reopen:40", "comment:40"}
	if !reflect.DeepEqual(h.issues.writes, want) {
		t.Fatalf("writes = %v, want %v", h.issues.writes, want)
	}
	got := h.issues.byNumber[40]
	if !strings.EqualFold(got.State, "open") {
		t.Errorf("issue state = %q, want open", got.State)
	}
	if delivery.HasLabel(got.Labels, delivery.LabelAgentWork) {
		t.Error("an unverified issue must not stay agent work, or the run re-works a merged fix")
	}
	if !delivery.HasLabel(got.Labels, sourcecontrol.LabelSREAgent) {
		t.Error("the incident marker must survive — it is what makes a recurrence recognisable")
	}
	if c := h.issues.comments[40]; len(c) != 1 || !strings.Contains(c[0], "unverified fix") {
		t.Errorf("the reopen must explain itself; an issue that reopens seconds after closing reads as a glitch: %v", c)
	}
}

// A vouched-for fix closes and stays closed. Recurrence still covers it from the
// closed side, so nothing is lost by trusting a `high`.
func TestHighConfidenceMerge_LeavesTheIssueClosed(t *testing.T) {
	h := newHarness(t, aRun("run-1", 7, delivery.RunStateRunning))
	h.cycles.latest = aCycle("cycle-1", "run-1")
	h.issues.withIssueState(40, "closed", delivery.LabelAgentWork, sourcecontrol.LabelSREAgent)

	if err := h.deliver(t, "pull_request",
		prBody("closed", "aep/m7-c1", "Resolves #40\n\nConfidence: high", 42, false, true, "abc123")); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if len(h.issues.writes) != 0 {
		t.Fatalf("a high-confidence merge must touch nothing, got %v", h.issues.writes)
	}
}

// Scope: ordinary spec-build work resolved by the same pull request closes as it
// always has. Only issues the SRE handoff filed are affected.
func TestUnverifiedMerge_LeavesOrdinaryWorkAlone(t *testing.T) {
	h := newHarness(t, aRun("run-1", 7, delivery.RunStateRunning))
	h.cycles.latest = aCycle("cycle-1", "run-1")
	h.issues.withIssueState(12, "closed", delivery.LabelAgentWork)

	if err := h.deliver(t, "pull_request",
		prBody("closed", "aep/m7-c1", "Resolves #12", 42, false, true, "abc123")); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if len(h.issues.writes) != 0 {
		t.Fatalf("spec-build work is outside this entirely, got %v", h.issues.writes)
	}
}

// A HUMAN merging the pull request reaches only this path — the policy is never
// consulted. A fix merged by hand is no more verified than one merged by the
// platform, so it gets the same treatment.
func TestUnverifiedMerge_AppliesToAHumanMergeToo(t *testing.T) {
	h := newHarness(t, aRun("run-1", 7, delivery.RunStateRunning))
	h.cycles.latest = aCycle("cycle-1", "run-1")
	h.issues.withIssueState(40, "closed", delivery.LabelAgentWork, sourcecontrol.LabelSREAgent)

	// No confidence line at all, merged from a branch the platform did not name.
	if err := h.deliver(t, "pull_request",
		prBody("closed", "hotfix/manual", "Resolves #40", 43, false, true, "feedface")); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if !strings.EqualFold(h.issues.byNumber[40].State, "open") {
		t.Error("a hand-merged incident fix with no declaration must leave its issue open")
	}
}

func TestUnverifiedMerge_Predicate(t *testing.T) {
	cases := []struct {
		name string
		body string
		want bool
	}{
		{"low is unverified", "Resolves #1\nConfidence: low", true},
		// Missing is unverified too: an agent that skipped the line its skill
		// mandates has told us nothing about its fix, and an open issue costs a
		// glance where a wrongly closed one costs the incident.
		{"missing is unverified", "Resolves #1", true},
		{"unparseable is unverified", "Resolves #1\nConfidence: fairly sure", true},
		{"high is verified", "Resolves #1\nConfidence: high", false},
		// Resolving nothing is not this run's work at all; there is no issue to
		// keep open and nothing to decide.
		{"resolving nothing is not our business", "Confidence: low", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := unverifiedMerge(c.body); got != c.want {
				t.Fatalf("unverifiedMerge(%q) = %v, want %v", c.body, got, c.want)
			}
		})
	}
}

// --- the no-change verdict reaching the run (ADR-0020) ----------------------
//
// A coding agent that finds no code change is possible closes the issue as
// `not_planned`. That empties the working set — but a cycle only ends by landing
// a merged pull request, so before this signal the run sat until its two-hour
// deadline and was then reported as agent death for an agent that was right.

// The signal fires when the last work in the milestone closes under a cycle that
// never opened a pull request.
func TestIssueClosed_EndsACycleThatHasNothingLeftToLand(t *testing.T) {
	h := newHarness(t, aRun("run-1", 7, delivery.RunStateRunning))
	h.cycles.latest = aCycle("cycle-1", "run-1") // PRNumber 0 — nothing opened
	h.issues.withCounts(7, 0, 0, 0)              // the working set is now empty

	if err := h.deliver(t, "issues", issueBody("closed", 40, 7, "aep", "someone", false)); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if got := h.sup.named(delivery.SigRunNoWork); len(got) != 1 {
		t.Fatalf("got %d no-work signals, want 1 — without it the cycle waits out its landing deadline", len(got))
	}
}

// THE RACE THIS MUST NOT LOSE. A merge also empties the working set. A cycle
// holding a pull request is waiting for that merge, and telling it the work is
// gone would end the cycle just as it was about to land.
func TestIssueClosed_NeverEndsACycleThatIsWaitingOnAPullRequest(t *testing.T) {
	h := newHarness(t, aRun("run-1", 7, delivery.RunStateRunning))
	cycle := aCycle("cycle-1", "run-1")
	cycle.PRNumber = 42
	h.cycles.latest = cycle
	h.issues.withCounts(7, 0, 0, 0)

	if err := h.deliver(t, "issues", issueBody("closed", 40, 7, "aep", "someone", false)); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if got := h.sup.named(delivery.SigRunNoWork); len(got) != 0 {
		t.Fatalf("signalled %d times; a cycle with a pull request is waiting for a merge, not for its work to vanish", len(got))
	}
}

// Work still in the milestone means the cycle has something to do. Only an
// EMPTY working set ends it.
func TestIssueClosed_DoesNotEndACycleWithWorkRemaining(t *testing.T) {
	h := newHarness(t, aRun("run-1", 7, delivery.RunStateRunning))
	h.cycles.latest = aCycle("cycle-1", "run-1")
	h.issues.withCounts(7, 0, 1, 1) // one issue still to work

	if err := h.deliver(t, "issues", issueBody("closed", 40, 7, "aep", "someone", false)); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if got := h.sup.named(delivery.SigRunNoWork); len(got) != 0 {
		t.Fatalf("signalled %d times with work left in the milestone", len(got))
	}
}

// A run that is not inside a cycle has no cycle to end; the parked-run path
// (wakeIfWorkable) owns that state.
func TestIssueClosed_DoesNotSignalAWaitingRun(t *testing.T) {
	h := newHarness(t, aRun("run-1", 7, delivery.RunStateWaiting))
	h.cycles.latest = aCycle("cycle-1", "run-1")
	h.issues.withCounts(7, 0, 0, 0)

	if err := h.deliver(t, "issues", issueBody("closed", 40, 7, "aep", "someone", false)); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if got := h.sup.named(delivery.SigRunNoWork); len(got) != 0 {
		t.Fatalf("signalled %d times; a waiting run is not in a cycle", len(got))
	}
}

// THE REGRESSION. A validation cycle's working set is empty BY DESIGN — the
// validation issue carries `aep:validation` and deliberately not `aep`, so
// OpenNonGateWork excludes it. Reading that emptiness as "the work was resolved"
// aborted validation 3.6s after it started, twice, and failed the run at
// `validation-unreported`. Only cycles whose work IS the working set may
// conclude anything from it being empty.
func TestIssueClosed_NeverEndsAValidationCycle(t *testing.T) {
	h := newHarness(t, aRun("run-1", 7, delivery.RunStateRunning))
	cycle := aCycle("cycle-1", "run-1")
	cycle.Kind = delivery.CycleKindValidation
	h.cycles.latest = cycle
	// Exactly the state a validation cycle always starts in: no pull request
	// yet, and a working set the validation issue is excluded from.
	h.issues.withCounts(7, 0, 0, 0)

	if err := h.deliver(t, "issues", issueBody("closed", 40, 7, "aep", "someone", false)); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if got := h.sup.named(delivery.SigRunNoWork); len(got) != 0 {
		t.Fatalf("signalled %d times; an empty working set is a validation cycle's normal state, not a verdict", len(got))
	}
}

// A fix cycle DOES work the working set, so the signal still applies to it.
func TestIssueClosed_StillEndsAFixCycleWithNothingLeft(t *testing.T) {
	h := newHarness(t, aRun("run-1", 7, delivery.RunStateRunning))
	cycle := aCycle("cycle-1", "run-1")
	cycle.Kind = delivery.CycleKindFix
	h.cycles.latest = cycle
	h.issues.withCounts(7, 0, 0, 0)

	if err := h.deliver(t, "issues", issueBody("closed", 40, 7, "aep", "someone", false)); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if got := h.sup.named(delivery.SigRunNoWork); len(got) != 1 {
		t.Fatalf("got %d signals, want 1 — a fix cycle's work is the working set", len(got))
	}
}
