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

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/ops"
)

// OpsFixProgress answers ops' FixProgressReader: how far the fix for one
// rca-agent-filed issue has got.
//
// It reads the RUN LOOP's own record. The previous implementation of this port
// projected `executions` rows, and that store no longer holds the run loop's
// work — the loop records cycles in `run_cycles` and mints no execution rows, so
// the correlation could not promote a single flag and the console's Verify Fix
// stepper sat at RCA forever, for every fix the platform shipped. Both halves are
// derived here from the same sources the console's own run rail uses, so the
// stepper and the rail cannot disagree about whether a fix landed.
//
// Reading the project's runs and their cycles costs a query per run. That is the
// same shape CycleBuilds.findCycle already has and is affordable for the same
// reason: this serves ONE report on a detail page, not a list or a poll.
type OpsFixProgress struct {
	runs   ProjectRunLister
	cycles CycleReader
	builds ProjectBuildLister
}

// NewOpsFixProgress wires the reader. A nil builds lister is a degraded boot
// without the OpenChoreo client: Dispatched is still answerable from the cycle
// rows, and Deployed then stays false — which is the honest answer, because
// whether a merge built is a question only the cluster can settle.
func NewOpsFixProgress(runs ProjectRunLister, cycles CycleReader, builds ProjectBuildLister) *OpsFixProgress {
	return &OpsFixProgress{runs: runs, cycles: cycles, builds: builds}
}

var _ ops.FixProgressReader = (*OpsFixProgress)(nil)

// FixProgress reports whether the issue's fix was dispatched and whether it
// deployed.
//
//   - Dispatched: a cycle of this project RESOLVES the issue. The cycle rows are
//     the run loop's record of what it dispatched at what, and `Resolves` is the
//     merge decision's own list — so this is the platform's answer, not an
//     inference from a label a human could have written by hand.
//   - Deployed: that cycle merged AND every component its merge touched built
//     green. Deliberately beyond merely PR-merged, which is the whole point of the
//     Verify Fix threshold: a merged fix that never built is not a fix in
//     production. Components carry auto-deploy, so a green build IS the rollout —
//     the same equivalence the run rail's Deployment stage draws.
//
// The NEWEST resolving cycle wins. An issue can be resolved twice — a refused
// merge followed by a conflict cycle that lands the same work (`resolves` carries
// the issue on both) — and it is the latest attempt that says where the fix is.
//
// A nil receiver or missing run/cycle reader yields the zero progress rather than
// an error: correlation is best-effort by contract, and a degraded boot must not
// turn a report read into a 500.
func (p *OpsFixProgress) FixProgress(ctx context.Context, orgID, projectID string, issueNumber int) (ops.FixProgress, error) {
	var out ops.FixProgress
	if p == nil || p.runs == nil || p.cycles == nil || issueNumber <= 0 {
		return out, nil
	}

	cycle, err := p.newestResolvingCycle(ctx, orgID, projectID, issueNumber)
	if err != nil {
		return out, err
	}
	if cycle == nil {
		return out, nil
	}
	out.Dispatched = true

	// Nothing merged, nothing to have built. The ordinary mid-cycle answer.
	if cycle.MergeSHA == "" || p.builds == nil {
		return out, nil
	}
	runsAtCluster, err := p.builds.ListProjectBuildRuns(ctx, orgID, projectID)
	if err != nil {
		return out, err
	}
	out.Deployed = mergeBuiltGreen(delivery.BuildsAtMerge(runsAtCluster, projectID, cycle.MergeSHA))
	return out, nil
}

// newestResolvingCycle finds the latest cycle of the project whose merge decision
// resolved the issue. Scoped by org through both reads, so a cross-tenant probe
// finds nothing rather than someone else's work.
func (p *OpsFixProgress) newestResolvingCycle(ctx context.Context, orgID, projectID string, issueNumber int) (*delivery.RunCycle, error) {
	// ListByProject is newest-run-first, and ListByRun is a run's timeline in
	// order, so the last match found while scanning a run is that run's newest and
	// the first run with a match is the newest run. Taking the newest match in the
	// newest run is therefore one pass with no sorting.
	rows, err := p.runs.ListByProject(ctx, orgID, projectID)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		cycles, err := p.cycles.ListByRun(ctx, orgID, rows[i].ID)
		if err != nil {
			return nil, err
		}
		var newest *delivery.RunCycle
		for j := range cycles {
			if resolvesIssue(cycles[j].Resolves, issueNumber) {
				newest = &cycles[j]
			}
		}
		if newest != nil {
			return newest, nil
		}
	}
	return nil, nil
}

func resolvesIssue(resolves []int, issueNumber int) bool {
	for _, n := range resolves {
		if n == issueNumber {
			return true
		}
	}
	return false
}

// mergeBuiltGreen reports whether every component a merge touched built cleanly.
//
// Zero builds is NOT green. It is the answer while the fan-out has not appeared in
// the cluster yet, and reading it as success would promote the stepper to Verify
// Fix in the window between a merge and its first build — announcing a rollout
// that has not started. The run loop's own CycleBuildState treats an empty
// expected set as green because it knows the merge touched no components; a
// reader that only sees the cluster cannot tell that apart from "not yet", so it
// must not guess.
//
// `Succeeded` rather than `Status` is the predicate on purpose: a terminal reason
// nobody recognised is not a success, and the console's rail draws exactly the
// same distinction (an unclassifiable outcome renders as attention, never done).
func mergeBuiltGreen(builds []delivery.MergeBuild) bool {
	if len(builds) == 0 {
		return false
	}
	for _, b := range builds {
		if !b.Completed || !b.Succeeded {
			return false
		}
	}
	return true
}
