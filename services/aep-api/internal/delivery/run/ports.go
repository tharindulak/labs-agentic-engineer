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
	"context"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// The consumer ports the supervisor's ACTIVITIES drive. Workflow code touches
// none of them — it only calls activities — so every I/O the loop performs is
// named here, in one list, and every one of them is faked by a plain struct in
// the tests.

// RunStore is the run row's write surface plus the one read the start path
// needs. Satisfied by an adapter over delivery.MilestoneRunRepository.
//
// Note what is NOT here: no read of the budget counters. The workflow counts
// its own budgets deterministically and writes them outwards for the read
// model — reading them back would make the loop's control flow depend on a
// database round trip that a replay cannot reproduce.
type RunStore interface {
	// TryAdmit inserts the run row unless the spec-run mutex refuses it. Used
	// only by the adoption/sweep start path, which must admit and supervise
	// together; the plan path admits its own row before planning.
	TryAdmit(ctx context.Context, row *delivery.MilestoneRun) (admitted bool, out *delivery.MilestoneRun, err error)
	// LiveRunForMilestone returns the non-terminal run already working this
	// milestone, or (nil, nil). It is what makes StartRun idempotent under the
	// reconcile sweep, which re-offers the same milestone every pass.
	LiveRunForMilestone(ctx context.Context, orgID, projectID string, milestoneNumber int) (*delivery.MilestoneRun, error)
	// MilestoneSpecTag returns the `v<N>` version the milestone's existing runs
	// belong to, "" when it has none. An incident run is admitted against a
	// milestone somebody else's build already claimed, and it holds no tag of its
	// own — without inheriting one it would surface in the version ledger under
	// the milestone's GitHub name instead of a version.
	MilestoneSpecTag(ctx context.Context, orgID, projectID string, milestoneNumber int) (string, error)
	// SetState moves the run between waiting and running.
	SetState(ctx context.Context, id, state string) error
	// Settle writes the terminal state and its reason, once.
	Settle(ctx context.Context, id, state, reason string) error
	// BumpBudget increments one counter — bookkeeping for the read model, never
	// the loop's own arithmetic.
	BumpBudget(ctx context.Context, id string, counter delivery.RunBudget) error
	// SetValidationVerdict records the validation cycle's outcome on the run,
	// together with the validation issue that produced it so a settled run stays
	// navigable to its criteria. An issue of 0 leaves the stored one untouched.
	SetValidationVerdict(ctx context.Context, id, verdict string, issue int) error
}

// CycleStore is the cycle-record surface: one row per dispatch. Satisfied by an
// adapter over delivery.RunCycleRepository.
//
// The supervisor writes the dispatch half (append, attempts, Job ref) and reads
// the half the EVENT PLANE writes (branch, pull request, merge SHA) — that read
// is the ground truth behind "did this cycle actually land?", which is why the
// loop never trusts a merge signal's payload on its own.
type CycleStore interface {
	Append(ctx context.Context, cycle *delivery.RunCycle) (cycleID string, err error)
	NoteDispatch(ctx context.Context, cycleID, jobRef string) error
	// NoteDispatchFailure records why an attempt could not launch an agent, and
	// spends the attempt. Without it a launch failure leaves the cycle
	// indistinguishable from one whose agent ran and did nothing.
	NoteDispatchFailure(ctx context.Context, cycleID, reason string) error
	Finish(ctx context.Context, cycleID, mergeSHA string) error
	// SetValidationVerdict records one validation ATTEMPT's outcome on its own cycle
	// row, so a run that validated more than once keeps every attempt's answer
	// rather than only the last. Written after Finish — the verdict comes from the
	// report at the cycle's merge commit, which does not exist until it has one.
	SetValidationVerdict(ctx context.Context, cycleID, verdict string, issue int) error
	Latest(ctx context.Context, orgID, runID string) (*delivery.RunCycle, error)
}

// MilestoneReader is the milestone's ground truth: the one-call dispatch
// predicate input, and the close that marks a settled version.
// sourcecontrol.IssueService satisfies it.
type MilestoneReader interface {
	// MilestoneIssueCounts is the whole cycle-boundary poll — gates, working set
	// and total in a single GraphQL round trip. Never the REST milestone's
	// open_issues field, which counts pull requests.
	MilestoneIssueCounts(ctx context.Context, orgID, projectID string, number int) (*sourcecontrol.MilestoneIssueCounts, error)
	// CloseMilestone closes a settled version's milestone. DISPLAY ONLY: no
	// platform logic branches on milestone state, and a closed milestone still
	// accepts new issues, which is what lets an incident adopt into an old
	// version with no reopening choreography.
	CloseMilestone(ctx context.Context, orgID, projectID string, number int) error
}

// PRReader reads a merged pull request's changed files — the path-diff input
// behind "which components did this cycle's merge rebuild?".
// sourcecontrol.IssueService satisfies it.
type PRReader interface {
	ListPullRequestFiles(ctx context.Context, orgID, projectID string, number int) ([]string, error)
}

// DesignReader maps each component to its App Path. An empty App Path means the
// component builds from the repo root and therefore matches any change.
type DesignReader interface {
	ComponentPaths(ctx context.Context, orgID, projectID string) (map[string]string, error)
}

// BuildRunInfo is one OpenChoreo WorkflowRun reduced to the two facts the
// supervisor needs. The OpenChoreo status vocabulary is deliberately mapped in
// the adapter: this package knows "terminal" and "succeeded", nothing about
// condition reasons.
type BuildRunInfo struct {
	Name      string `json:"name"`
	Terminal  bool   `json:"terminal"`
	Succeeded bool   `json:"succeeded"`
}

// BuildReader reads back a component's WorkflowRuns.
//
// Read-only, deliberately: the supervisor never triggers a build and never
// re-triggers one. The automatic re-trigger budget belongs to the event plane
// and is DERIVED from these very runs, so the supervisor counts the same runs
// to learn the same verdict rather than keeping a second tally that could
// disagree.
type BuildReader interface {
	ListBuildRuns(ctx context.Context, orgID, projectID, component string) ([]BuildRunInfo, error)
}

// ValidationCoordinator is the validation half of the loop, reached as a port
// because `delivery/validation` is a sibling slice.
//
// Both calls are idempotent and both degrade to "skipped" rather than failing:
// a project with no acceptance oracle simply has nothing to validate, and that
// is a legitimate verdict, not an error.
type ValidationCoordinator interface {
	// EnsureValidationIssue mints the run's validation issue into the milestone
	// at deployed-green and returns its number, or 0 when the project has no
	// acceptance criteria. Minting here rather than at plan time is what keeps
	// an unworkable issue out of the working set for the whole run.
	EnsureValidationIssue(ctx context.Context, orgID, projectID string, milestoneNumber int) (int, error)
	// Verdict reads the validation runner's committed report AT `at` — the
	// validation cycle's own merge commit — and returns one of the
	// delivery.ValidationVerdict* values, plus a DIGEST of the evidence it was
	// derived from.
	//
	// The commit is not optional in spirit: the report lives at one fixed path
	// that every run overwrites, so reading the branch tip returns the newest
	// run's results regardless of which run is asking. A run whose agent shipped
	// no report would inherit its predecessor's and be handed a confidently wrong
	// verdict. An empty `at` still reads the tip, for a caller that has no commit.
	//
	// The digest exists so the loop can tell a repeat attempt that learned something
	// from one that learned nothing. It covers the criteria and their outcomes ONLY,
	// never the raw file — the report embeds the commit it was generated at, so a
	// whole-file hash would differ on every attempt and could never match.
	Verdict(ctx context.Context, orgID, projectID, at string) (verdict, digest string, err error)

	// MintRepairIssues turns a `failed` attempt's report into ordinary work: one
	// issue per failed criterion, filed into the milestone, which the next cycle
	// picks out of the working set like any other. Returns the issue numbers.
	//
	// It reads the report at the same pinned commit the verdict came from. cycleID
	// is the attempt's identity and becomes the issues' dedupe key, so a retry
	// within one attempt files nothing new while the next attempt files fresh work.
	MintRepairIssues(ctx context.Context, orgID, projectID string, milestoneNumber int, at, cycleID string) ([]int, error)
}

// Dispatcher launches one agent run over the milestone. It is the locally
// declared consumer view of the root delivery.MilestoneDispatcher port, which
// the coding agent satisfies — the supervisor names a capability, not a
// package.
type Dispatcher interface {
	Dispatch(ctx context.Context, req delivery.MilestoneDispatch) (jobRef string, err error)
}

// APITraitSyncer lands the per-environment `api-configuration` trait config —
// the `jwtAuth` policy the gateway enforces and the sibling-SPA CORS allowlist
// — on each protected component's ReleaseBinding. projects.TraitSyncService
// satisfies it.
//
// Why the supervisor drives this at all: the config's write target is the
// ReleaseBinding, which OpenChoreo creates only once a build has produced a
// workload. The Component CR's trait SHAPE is set far earlier (at component
// ensure, pre-build) and is what makes OpenChoreo render the RestApi; this is
// the other half, and it cannot be written before the deploy chain has run.
// Builds settling green is the first moment in the run where that is true.
//
// Idempotent and convergent: re-running it re-asserts the same desired state,
// so a cycle that syncs twice costs a round trip and changes nothing.
type APITraitSyncer interface {
	SyncProjectAPITraits(ctx context.Context, orgID, projectID string) error
}
