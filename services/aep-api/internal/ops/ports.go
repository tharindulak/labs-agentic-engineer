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

package ops

import (
	"context"
)

// The ports ops needs FROM other domains, declared in ops' OWN vocabulary
// (all cross-domain edges are consumer-side ports wired at the root).
//
// Because the port is written in ops' terms, ops depends on delivery only through
// a read contract it owns: delivery implements FixProgressReader directly, and
// ops names no delivery type.

// FixProgress is how far the fix for ONE rca-agent-filed issue has got, in
// exactly the two steps the console's Coding Handover / Verify Fix stepper draws.
//
// It is deliberately not a projection of whatever delivery stores. An earlier
// version of this port spoke delivery's execution vocabulary (kind + status per
// execution row) and left ops to decide what "dispatched" and "deployed" meant
// from it. That coupled the stepper to one particular RECORD of the work, and
// when delivery moved the run loop's record from `executions` to `run_cycles`
// the port kept answering — with nothing, for every report. Asking the question
// ops actually has ("did it dispatch, did it deploy") puts the burden of
// answering it on the domain that owns the work.
type FixProgress struct {
	// Dispatched: a coding agent has been dispatched at the issue.
	Dispatched bool
	// Deployed: the fix the agent landed has BUILT AND ROLLED — the "Verify Fix"
	// threshold, deliberately beyond merely PR-merged.
	Deployed bool
}

// FixProgressReader answers how far one rca-agent-filed issue's fix has got,
// fenced to an org. It lets GetReport reconcile a report's Dispatched/Deployed
// snapshot against the live state of the work: a report is written once at RCA
// time, so its snapshot goes stale as a coding agent is later dispatched and the
// fix is built and deployed.
//
// Keyed by PROJECT and issue number rather than by a repo slug: the project is
// how the work itself is keyed, and the report carries it directly, so nothing
// here has to re-derive a repo from an issue URL and be wrong about a host whose
// URL grammar differs.
//
// Optional — a nil reader disables correlation and the stored snapshot is served
// as-is, which is the honest degradation when the provider is absent.
type FixProgressReader interface {
	FixProgress(ctx context.Context, orgID, projectID string, issueNumber int) (FixProgress, error)
}
