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
	"log/slog"

	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/ops"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
)

// Handler serves get-rca-agent-report.
type Handler struct {
	reports  ops.Repository
	progress ops.FixProgressReader
}

// New returns the slice's handler. progress may be nil, which disables
// correlation.
func New(reports ops.Repository, progress ops.FixProgressReader) *Handler {
	return &Handler{reports: reports, progress: progress}
}

// GetRcaAgentReport returns a single report, 404 when absent.
//
// The report's Dispatched/Deployed fields are reconciled against the live state
// of the fix so the console's Coding Handover / Verify Fix stepper reflects where
// the work actually is rather than the write-time snapshot.
func (h *Handler) GetRcaAgentReport(ctx context.Context, request gen.GetRcaAgentReportRequestObject) (gen.GetRcaAgentReportResponseObject, error) {
	org := tenant.BoundOrgFromContext(ctx)

	report, err := h.reports.Get(ctx, org, request.ReportID)
	if err != nil {
		return nil, apierr.Internal("failed to get rca-agent report")
	}
	if report == nil {
		return nil, apierr.NotFound("rca-agent report not found")
	}
	h.correlate(ctx, org, report)
	return gen.GetRcaAgentReport200JSONResponse(ops.ToWire(*report)), nil
}

// correlate upgrades a report's Dispatched/Deployed flags from the live progress
// of the linked issue's fix (project + issue number).
//
// It only ever promotes false→true, never the reverse: a writer that already knew
// the agent was dispatched must not be contradicted by a reader that cannot see
// the work. A no-op when correlation is disabled (nil reader), the report has no
// linked issue, or the report names no project.
//
// DeployedAt is deliberately NOT set here, only preserved. The flags are derivable
// from live state; the moment a rollout completed is not — a cycle's row closes at
// its merge, and per-component build state is a projection of the cluster that
// carries no completion time. Stamping "now" would date every fix to whenever the
// console last polled, which is worse than an absent timestamp. It stays the
// writer's to record.
func (h *Handler) correlate(ctx context.Context, orgID string, report *ops.RcaAgentReport) {
	if h.progress == nil || report == nil || report.IssueNumber == nil || report.Project == "" {
		return
	}
	progress, err := h.progress.FixProgress(ctx, orgID, report.Project, int(*report.IssueNumber))
	if err != nil {
		// Correlation is best-effort: serve the stored snapshot on lookup error.
		slog.WarnContext(ctx, "ops: fix-progress correlation failed",
			"issue", *report.IssueNumber, "project", report.Project, "error", err)
		return
	}
	if progress.Dispatched {
		report.Dispatched = true
	}
	if progress.Deployed {
		report.Deployed = true
	}
}
