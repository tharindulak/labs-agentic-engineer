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

package runread

import (
	"context"
	"errors"
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

// The shape the live stack produced and this reader exists to answer for: an
// rca-agent issue adopted into the spec build in flight, worked by a coding
// cycle, merged, and built green. Before this reader the same facts correlated to
// nothing, because the port projected `executions` rows and the run loop writes
// none.
const (
	fixOrg     = "acme"
	fixProject = "demo"
	fixIssue   = 5
	fixSHA     = "41c8a42c6286"
)

type fixRuns struct {
	byProject map[string][]delivery.MilestoneRun
	err       error
	gotOrg    string
}

func (f *fixRuns) ListByProject(_ context.Context, orgID, projectID string) ([]delivery.MilestoneRun, error) {
	f.gotOrg = orgID
	return f.byProject[projectID], f.err
}

type fixCycles struct {
	byRun map[string][]delivery.RunCycle
	err   error
}

func (f *fixCycles) ListByRun(_ context.Context, _, runID string) ([]delivery.RunCycle, error) {
	return f.byRun[runID], f.err
}

type fixBuilds struct {
	runs  []delivery.MergeBuild
	err   error
	calls int
}

func (f *fixBuilds) ListProjectBuildRuns(context.Context, string, string) ([]delivery.MergeBuild, error) {
	f.calls++
	return f.runs, f.err
}

// greenBuild names a build the way the fan-out does, so BuildsAtMerge matches it.
func greenBuild(component string) delivery.MergeBuild {
	return delivery.MergeBuild{
		Component: component,
		RunName:   delivery.BuildRunName(fixProject, component, fixSHA, 1),
		Status:    "WorkflowSucceeded",
		Completed: true,
		Succeeded: true,
	}
}

func codingCycle(id string, resolves []int, mergeSHA string) delivery.RunCycle {
	return delivery.RunCycle{
		ID: id, OrgID: fixOrg, ProjectID: fixProject,
		Kind: delivery.CycleKindCoding, Resolves: resolves, MergeSHA: mergeSHA,
	}
}

// oneRun wires the common single-run fixture and returns the reader.
//
// builds is the PORT type, not *fixBuilds: passing a nil *fixBuilds would hand
// the reader a non-nil interface holding a nil pointer, which is not the absent
// dependency the nil guard is about — it is a wiring bug that segfaults. Taking
// the interface makes `oneRun(cycles, nil)` mean what it reads as.
func oneRun(cycles []delivery.RunCycle, builds ProjectBuildLister) *OpsFixProgress {
	runs := &fixRuns{byProject: map[string][]delivery.MilestoneRun{
		fixProject: {{ID: "run-1", OrgID: fixOrg, ProjectID: fixProject}},
	}}
	return NewOpsFixProgress(runs, &fixCycles{byRun: map[string][]delivery.RunCycle{"run-1": cycles}}, builds)
}

func progress(t *testing.T, r *OpsFixProgress) (dispatched, deployed bool) {
	t.Helper()
	got, err := r.FixProgress(context.Background(), fixOrg, fixProject, fixIssue)
	if err != nil {
		t.Fatalf("FixProgress: %v", err)
	}
	return got.Dispatched, got.Deployed
}

// The regression this fix exists for, stated as one test: a cycle resolved the
// issue, merged, and its component built green — so the console's stepper must
// reach Verify Fix. This returned (false, false) for every fix the platform
// shipped while the port read `executions`.
func TestFixProgress_dispatchedAndDeployed(t *testing.T) {
	r := oneRun(
		[]delivery.RunCycle{codingCycle("c1", []int{fixIssue}, fixSHA)},
		&fixBuilds{runs: []delivery.MergeBuild{greenBuild("service1")}},
	)

	dispatched, deployed := progress(t, r)
	if !dispatched {
		t.Error("Dispatched = false, want true: a coding cycle resolves the issue")
	}
	if !deployed {
		t.Error("Deployed = false, want true: the merge built green")
	}
}

// An issue no cycle resolves has not been dispatched. This is the state a report
// is written in, and the one the correlation must not promote out of.
func TestFixProgress_unresolvedIssueIsNotDispatched(t *testing.T) {
	r := oneRun(
		[]delivery.RunCycle{codingCycle("c1", []int{1, 2}, fixSHA)},
		&fixBuilds{runs: []delivery.MergeBuild{greenBuild("service1")}},
	)

	if dispatched, deployed := progress(t, r); dispatched || deployed {
		t.Errorf("(dispatched, deployed) = (%v, %v), want (false, false) for an issue no cycle resolves", dispatched, deployed)
	}
}

// Dispatched without a merge is the ordinary mid-cycle answer: the agent is
// working and there is nothing that could have built.
func TestFixProgress_noMergeIsDispatchedOnly(t *testing.T) {
	builds := &fixBuilds{runs: []delivery.MergeBuild{greenBuild("service1")}}
	r := oneRun([]delivery.RunCycle{codingCycle("c1", []int{fixIssue}, "")}, builds)

	dispatched, deployed := progress(t, r)
	if !dispatched {
		t.Error("Dispatched = false, want true")
	}
	if deployed {
		t.Error("Deployed = true with no merge SHA")
	}
	if builds.calls != 0 {
		t.Errorf("hit the cluster %d times for a cycle that had not merged — that read is the expensive one", builds.calls)
	}
}

// The Verify Fix THRESHOLD: merged is not deployed. Promoting here would tell
// somebody their incident is fixed while the build that carries the fix is still
// running, or has failed.
func TestFixProgress_mergedButNotGreenIsNotDeployed(t *testing.T) {
	red := greenBuild("service1")
	red.Status, red.Succeeded = "WorkflowFailed", false
	running := greenBuild("service2")
	running.Completed, running.Succeeded = false, false

	for name, build := range map[string]delivery.MergeBuild{
		"failed build":  red,
		"running build": running,
	} {
		t.Run(name, func(t *testing.T) {
			r := oneRun(
				[]delivery.RunCycle{codingCycle("c1", []int{fixIssue}, fixSHA)},
				&fixBuilds{runs: []delivery.MergeBuild{build}},
			)
			if _, deployed := progress(t, r); deployed {
				t.Error("Deployed = true — the threshold is a GREEN build, not merely a merge")
			}
		})
	}
}

// A partially-green fan-out is not deployed: the fix is only in production once
// every component the merge touched is running it.
func TestFixProgress_partialFanOutIsNotDeployed(t *testing.T) {
	red := greenBuild("service2")
	red.Status, red.Succeeded = "WorkflowFailed", false
	r := oneRun(
		[]delivery.RunCycle{codingCycle("c1", []int{fixIssue}, fixSHA)},
		&fixBuilds{runs: []delivery.MergeBuild{greenBuild("service1"), red}},
	)

	if _, deployed := progress(t, r); deployed {
		t.Error("Deployed = true with one component red")
	}
}

// No builds in the cluster yet is NOT green. This is the window between a merge
// and its fan-out appearing, and reading it as success would announce a rollout
// that has not started.
func TestFixProgress_noBuildsYetIsNotDeployed(t *testing.T) {
	r := oneRun(
		[]delivery.RunCycle{codingCycle("c1", []int{fixIssue}, fixSHA)},
		&fixBuilds{runs: nil},
	)

	dispatched, deployed := progress(t, r)
	if !dispatched {
		t.Error("Dispatched = false, want true")
	}
	if deployed {
		t.Error("Deployed = true with no builds in the cluster — an absent fan-out is 'not yet', not success")
	}
}

// A terminal reason the platform does not recognise must not read as success —
// the same rule the console's rail follows. `Succeeded` is normalised at the
// adapter precisely so this cannot be decided by string-matching here.
func TestFixProgress_unknownBuildOutcomeIsNotDeployed(t *testing.T) {
	odd := greenBuild("service1")
	odd.Status, odd.Succeeded = "WorkflowSomethingElse", false
	r := oneRun([]delivery.RunCycle{codingCycle("c1", []int{fixIssue}, fixSHA)}, &fixBuilds{runs: []delivery.MergeBuild{odd}})

	if _, deployed := progress(t, r); deployed {
		t.Error("Deployed = true for an outcome nobody classified")
	}
}

// The newest resolving cycle wins. A refused merge followed by a conflict cycle
// that lands the same work carries the issue on BOTH, and it is the later attempt
// that says where the fix is — reading the earlier one would report a fix that
// merged as never merged.
func TestFixProgress_newestResolvingCycleWins(t *testing.T) {
	// The refused attempt never merged, so it carries no merge SHA.
	refused := codingCycle("c1", []int{fixIssue}, "")
	landed := delivery.RunCycle{
		ID: "c2", OrgID: fixOrg, ProjectID: fixProject,
		Kind: delivery.CycleKindConflict, Resolves: []int{fixIssue}, MergeSHA: fixSHA,
	}
	r := oneRun([]delivery.RunCycle{refused, landed}, &fixBuilds{runs: []delivery.MergeBuild{greenBuild("service1")}})

	dispatched, deployed := progress(t, r)
	if !dispatched || !deployed {
		t.Errorf("(dispatched, deployed) = (%v, %v), want (true, true) — the conflict cycle landed the fix", dispatched, deployed)
	}
}

// The run that adopted an rca-agent issue is whichever was in flight, so the
// search spans the project's runs rather than one version's.
func TestFixProgress_findsTheIssueInAnyRunOfTheProject(t *testing.T) {
	runs := &fixRuns{byProject: map[string][]delivery.MilestoneRun{
		fixProject: {
			{ID: "run-2", OrgID: fixOrg, ProjectID: fixProject},
			{ID: "run-1", OrgID: fixOrg, ProjectID: fixProject},
		},
	}}
	cycles := &fixCycles{byRun: map[string][]delivery.RunCycle{
		"run-2": {codingCycle("c9", []int{99}, fixSHA)},
		"run-1": {codingCycle("c1", []int{fixIssue}, fixSHA)},
	}}
	r := NewOpsFixProgress(runs, cycles, &fixBuilds{runs: []delivery.MergeBuild{greenBuild("service1")}})

	if dispatched, _ := progress(t, r); !dispatched {
		t.Error("Dispatched = false — the issue's cycle lives in an older run of the same project")
	}
	if runs.gotOrg != fixOrg {
		t.Errorf("listed runs for org %q, want %q — the read must stay org-fenced", runs.gotOrg, fixOrg)
	}
}

// A degraded boot without the OpenChoreo client still answers Dispatched, and
// answers Deployed=false rather than guessing: whether a merge built is a
// question only the cluster can settle.
func TestFixProgress_nilBuildsListerStillAnswersDispatched(t *testing.T) {
	r := oneRun([]delivery.RunCycle{codingCycle("c1", []int{fixIssue}, fixSHA)}, nil)

	dispatched, deployed := progress(t, r)
	if !dispatched {
		t.Error("Dispatched = false, want true without a builds lister")
	}
	if deployed {
		t.Error("Deployed = true without a builds lister — that is a guess")
	}
}

// Errors propagate so the caller can serve the stored snapshot and log; they must
// not be swallowed into a confident (false, false).
func TestFixProgress_errorsPropagate(t *testing.T) {
	boom := errors.New("store unavailable")

	runs := &fixRuns{err: boom}
	if _, err := NewOpsFixProgress(runs, &fixCycles{}, nil).
		FixProgress(context.Background(), fixOrg, fixProject, fixIssue); !errors.Is(err, boom) {
		t.Errorf("run-list error = %v, want %v", err, boom)
	}

	r := oneRun([]delivery.RunCycle{codingCycle("c1", []int{fixIssue}, fixSHA)}, &fixBuilds{err: boom})
	if _, err := r.FixProgress(context.Background(), fixOrg, fixProject, fixIssue); !errors.Is(err, boom) {
		t.Errorf("build-list error = %v, want %v", err, boom)
	}
}

// Guards that must not panic or scan on a degraded/nonsense call.
func TestFixProgress_guards(t *testing.T) {
	var nilReader *OpsFixProgress
	if got, err := nilReader.FixProgress(context.Background(), fixOrg, fixProject, fixIssue); err != nil || got.Dispatched {
		t.Errorf("nil receiver = (%+v, %v), want zero progress and no error", got, err)
	}

	runs := &fixRuns{byProject: map[string][]delivery.MilestoneRun{
		fixProject: {{ID: "run-1", OrgID: fixOrg, ProjectID: fixProject}},
	}}
	cycles := &fixCycles{byRun: map[string][]delivery.RunCycle{
		"run-1": {codingCycle("c1", []int{fixIssue}, fixSHA)},
	}}
	r := NewOpsFixProgress(runs, cycles, &fixBuilds{runs: []delivery.MergeBuild{greenBuild("service1")}})
	// Issue 0 is "no linked issue" — resolving it against a cycle's Resolves list
	// would match nothing, but the scan should not happen at all.
	if got, err := r.FixProgress(context.Background(), fixOrg, fixProject, 0); err != nil || got.Dispatched {
		t.Errorf("issue 0 = (%+v, %v), want zero progress and no error", got, err)
	}
}
