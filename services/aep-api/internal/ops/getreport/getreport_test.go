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

package getreport

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/ops"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
)

type fakeRepo struct {
	byID map[string]*ops.RcaAgentReport
}

func (f *fakeRepo) Create(context.Context, *ops.RcaAgentReport) error { return nil }
func (f *fakeRepo) Get(_ context.Context, _, id string) (*ops.RcaAgentReport, error) {
	return f.byID[id], nil
}
func (f *fakeRepo) List(context.Context, string, string, int) ([]ops.RcaAgentReport, string, error) {
	return nil, "", nil
}

// fakeProgress records what the slice asked for, so the tests can pin that the
// PROJECT and issue number are what the correlation is keyed by.
type fakeProgress struct {
	progress   ops.FixProgress
	err        error
	gotProject string
	gotIssue   int
	calls      int
}

func (f *fakeProgress) FixProgress(_ context.Context, _, projectID string, issueNumber int) (ops.FixProgress, error) {
	f.calls++
	f.gotProject, f.gotIssue = projectID, issueNumber
	return f.progress, f.err
}

func ctxWithOrg(org string) context.Context {
	return tenant.WithBoundOrg(context.Background(), org)
}

func issueReport(id string) *ops.RcaAgentReport {
	n := int64(42)
	return &ops.RcaAgentReport{
		ID: id, OrgID: "acme", Project: "proj", Title: "t", Summary: "s",
		Classification: "code-level", Diagnosis: "d",
		IssueNumber: &n,
		IssueURL:    "https://github.com/acme/proj/issues/42",
	}
}

func get(t *testing.T, h *Handler, id string) gen.RcaAgentReport {
	t.Helper()
	resp, err := h.GetRcaAgentReport(ctxWithOrg("acme"), gen.GetRcaAgentReportRequestObject{ReportID: id})
	if err != nil {
		t.Fatalf("GetRcaAgentReport: %v", err)
	}
	out, ok := resp.(gen.GetRcaAgentReport200JSONResponse)
	if !ok {
		t.Fatalf("response = %T, want 200", resp)
	}
	return gen.RcaAgentReport(out)
}

// TestGetReport_correlatesFixProgress pins the read-time reconciliation: a report
// written before the agent was dispatched must not keep serving that stale
// snapshot. This is the whole reason the stepper is correlated rather than read
// straight off the row.
func TestGetReport_correlatesFixProgress(t *testing.T) {
	repo := &fakeRepo{byID: map[string]*ops.RcaAgentReport{"r1": issueReport("r1")}}
	progress := &fakeProgress{progress: ops.FixProgress{Dispatched: true, Deployed: true}}

	got := get(t, New(repo, progress), "r1")

	if !got.Dispatched {
		t.Error("Dispatched = false, want true (the fix was dispatched)")
	}
	if !got.Deployed {
		t.Error("Deployed = false, want true (the fix built and rolled)")
	}
	// Keyed by PROJECT, not by a repo slug re-derived from the issue URL.
	if progress.gotProject != "proj" || progress.gotIssue != 42 {
		t.Errorf("looked up (%q, %d), want (proj, 42)", progress.gotProject, progress.gotIssue)
	}
}

// TestGetReport_dispatchedWithoutDeployed is the state every fix passes through:
// the agent has run and its work has not rolled yet. The stepper must show the
// first step reached and the second not, which is exactly what was impossible
// while correlation read a store the run loop had stopped writing.
func TestGetReport_dispatchedWithoutDeployed(t *testing.T) {
	repo := &fakeRepo{byID: map[string]*ops.RcaAgentReport{"r1": issueReport("r1")}}
	progress := &fakeProgress{progress: ops.FixProgress{Dispatched: true}}

	got := get(t, New(repo, progress), "r1")

	if !got.Dispatched {
		t.Error("Dispatched = false, want true")
	}
	if got.Deployed {
		t.Error("Deployed = true before the fix rolled — the Verify Fix step is not reached at dispatch")
	}
}

// TestGetReport_correlationIsMonotonic pins false→true only: a writer that
// already knew the agent was dispatched must never be contradicted by a reader
// that cannot see the work.
func TestGetReport_correlationIsMonotonic(t *testing.T) {
	stored := issueReport("r1")
	stored.Dispatched = true
	stored.Deployed = true
	repo := &fakeRepo{byID: map[string]*ops.RcaAgentReport{"r1": stored}}

	got := get(t, New(repo, &fakeProgress{}), "r1")

	if !got.Dispatched || !got.Deployed {
		t.Errorf("correlation downgraded a stored true: Dispatched=%v Deployed=%v", got.Dispatched, got.Deployed)
	}
}

// TestGetReport_correlationPreservesDeployedAt: the flags are derivable from live
// state, the MOMENT of a rollout is not — a cycle row closes at its merge and
// per-component build state carries no completion time. Correlation must leave a
// writer's timestamp alone rather than restamp it, and must not invent one.
func TestGetReport_correlationPreservesDeployedAt(t *testing.T) {
	at := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	stored := issueReport("r1")
	stored.DeployedAt = &at
	repo := &fakeRepo{byID: map[string]*ops.RcaAgentReport{"r1": stored}}

	got := get(t, New(repo, &fakeProgress{progress: ops.FixProgress{Dispatched: true, Deployed: true}}), "r1")

	if got.DeployedAt == nil || !got.DeployedAt.Equal(at) {
		t.Errorf("DeployedAt = %v, want the writer's %v preserved", got.DeployedAt, at)
	}

	fresh := &fakeRepo{byID: map[string]*ops.RcaAgentReport{"r2": issueReport("r2")}}
	if got := get(t, New(fresh, &fakeProgress{progress: ops.FixProgress{Deployed: true}}), "r2"); got.DeployedAt != nil {
		t.Errorf("DeployedAt = %v, want nil — correlation must not invent a rollout time", got.DeployedAt)
	}
}

// TestGetReport_correlationIsBestEffort: a reader failure serves the snapshot
// rather than failing the read.
func TestGetReport_correlationIsBestEffort(t *testing.T) {
	repo := &fakeRepo{byID: map[string]*ops.RcaAgentReport{"r1": issueReport("r1")}}
	progress := &fakeProgress{
		progress: ops.FixProgress{Dispatched: true, Deployed: true},
		err:      errors.New("run store unavailable"),
	}

	if got := get(t, New(repo, progress), "r1"); got.Dispatched || got.Deployed {
		t.Error("a correlation error must leave the stored snapshot untouched")
	}
}

func TestGetReport_noReader_servesStoredSnapshot(t *testing.T) {
	repo := &fakeRepo{byID: map[string]*ops.RcaAgentReport{"r1": issueReport("r1")}}

	// nil reader = correlation disabled; must not panic.
	if got := get(t, New(repo, nil), "r1"); got.Dispatched || got.Deployed {
		t.Error("correlation ran with a nil reader")
	}
}

// TestGetReport_noIssueSkipsCorrelation: a config-only handoff has no linked
// issue, so there is nothing to correlate against.
func TestGetReport_noIssueSkipsCorrelation(t *testing.T) {
	r := issueReport("r1")
	r.IssueNumber = nil
	repo := &fakeRepo{byID: map[string]*ops.RcaAgentReport{"r1": r}}
	progress := &fakeProgress{}

	get(t, New(repo, progress), "r1")

	if progress.calls != 0 {
		t.Errorf("correlated a report with no linked issue (%d calls)", progress.calls)
	}
}

// TestGetReport_noProjectSkipsCorrelation: the project is the correlation key, so
// a report without one cannot be correlated — and must not be looked up under the
// empty project, which would scan whatever that resolves to.
func TestGetReport_noProjectSkipsCorrelation(t *testing.T) {
	r := issueReport("r1")
	r.Project = ""
	repo := &fakeRepo{byID: map[string]*ops.RcaAgentReport{"r1": r}}
	progress := &fakeProgress{}

	get(t, New(repo, progress), "r1")

	if progress.calls != 0 {
		t.Errorf("correlated a report with no project (%d calls)", progress.calls)
	}
}

func TestGetReport_NotFound(t *testing.T) {
	_, err := New(&fakeRepo{byID: map[string]*ops.RcaAgentReport{}}, nil).
		GetRcaAgentReport(ctxWithOrg("acme"), gen.GetRcaAgentReportRequestObject{ReportID: "nope"})

	var ae *apierr.Error
	if !errors.As(err, &ae) || ae.Status != 404 {
		t.Fatalf("err = %v, want a 404 apierr", err)
	}
}
