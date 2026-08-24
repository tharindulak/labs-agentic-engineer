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

package createreport

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/ops"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
)

// validClassifications is the closed set the handoff agent may send.
var validClassifications = map[string]bool{
	"code-level":   true,
	"config-level": true,
	"mixed":        true,
	"none":         true,
}

// Handler serves create-rca-agent-report.
type Handler struct {
	reports   ops.Repository
	escalator ops.IssueEscalator
}

// New returns the slice's handler.
func New(reports ops.Repository) *Handler { return &Handler{reports: reports} }

// WithEscalator wires the escalation filer. Optional: nil leaves a declined
// report stored exactly as the handoff sent it. Chained at construction (the
// same shape as NewIDPService().WithSecretRefWriter()), never after assembly.
func (h *Handler) WithEscalator(e ops.IssueEscalator) *Handler {
	h.escalator = e
	return h
}

// CreateRcaAgentReport validates and persists a new report.
//
// The caller is any userJWT holder scoped to the org — including a
// widened-audience service-account token; there is no separate service-auth
// scheme (BE handshake #156). The deny-by-default tenant gate binds the active
// org from the verified token before this runs, so org is read from the context
// and never from the request.
func (h *Handler) CreateRcaAgentReport(ctx context.Context, request gen.CreateRcaAgentReportRequestObject) (gen.CreateRcaAgentReportResponseObject, error) {
	org := tenant.BoundOrgFromContext(ctx)

	report, err := toDomain(org, request.Body)
	if err != nil {
		return nil, apierr.BadRequest(err.Error())
	}
	// Before the insert, so one write records both the report and the issue it
	// caused — no second UPDATE, and no window where the report exists claiming
	// no issue while one is already being worked.
	h.escalate(ctx, org, report)
	if err := h.reports.Create(ctx, report); err != nil {
		return nil, apierr.Internal("failed to create rca-agent report")
	}
	return gen.CreateRcaAgentReport201JSONResponse(ops.ToWire(*report)), nil
}

// escalate files the issue the handoff should have filed, and records it on the
// report. Best-effort by construction: a report that cannot be stored is an
// incident nothing recovers, so no failure here reaches the caller.
//
// It mutates report rather than returning, because the fields it sets belong to
// the same row the caller is about to insert.
func (h *Handler) escalate(ctx context.Context, org string, report *ops.RcaAgentReport) {
	if h.escalator == nil {
		return
	}
	decision := shouldEscalate(report)
	if !decision.escalate {
		slog.DebugContext(ctx, "rca report: not escalated",
			"project", report.Project, "component", report.Component,
			"classification", report.Classification, "reason", decision.reason)
		return
	}

	title, body := escalationIssue(report, decision.actions)
	filed, err := h.escalator.FileAndDispatch(ctx, org, report.Project,
		unprefixedComponent(report.Project, report.Component),
		title, body, escalationDedupeKey(report))
	if err != nil {
		slog.ErrorContext(ctx, "rca report: escalation filing failed; report stored without an issue",
			"project", report.Project, "component", report.Component, "error", err)
		return
	}

	n := filed.Number
	report.IssueNumber = &n
	report.IssueURL = filed.URL
	report.IssueTitle = title
	report.Dispatched = filed.Adopted

	slog.InfoContext(ctx, "rca report: escalated a high-confidence decline into an issue",
		"project", report.Project, "component", report.Component,
		"classification", report.Classification, "issue", filed.Number,
		"adopted", filed.Adopted, "adoptionError", filed.AdoptionError,
		"codeLevelActions", len(decision.actions))
}

// unprefixedComponent strips the project prefix the report carries but the
// adopter refuses — it resolves component names as AE's design names them. An
// empty result means "no component", which the filer treats as project-scoped.
func unprefixedComponent(project, component string) string {
	component = strings.TrimSpace(component)
	if component == "" || component == project {
		return ""
	}
	return strings.TrimPrefix(component, project+"-")
}

// toDomain validates the wire body and maps it onto the domain entity. Fields
// the contract marks required are enforced here rather than left to a DB NOT
// NULL error, so the caller gets a precise 400.
func toDomain(org string, in *gen.CreateRcaAgentReportRequest) (*ops.RcaAgentReport, error) {
	if in == nil {
		return nil, fmt.Errorf("%w: request body is required", ops.ErrInvalidReport)
	}
	var missing []string
	if in.Project == "" {
		missing = append(missing, "project")
	}
	if in.Title == "" {
		missing = append(missing, "title")
	}
	if in.Summary == "" {
		missing = append(missing, "summary")
	}
	if in.Diagnosis == "" {
		missing = append(missing, "diagnosis")
	}
	if in.Classification == "" {
		missing = append(missing, "classification")
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("%w: missing required field(s): %v", ops.ErrInvalidReport, missing)
	}
	if !validClassifications[in.Classification] {
		return nil, fmt.Errorf("%w: classification %q must be one of code-level, config-level, mixed, none",
			ops.ErrInvalidReport, in.Classification)
	}
	return &ops.RcaAgentReport{
		OrgID:          org,
		Project:        in.Project,
		Component:      in.Component,
		Title:          in.Title,
		Summary:        in.Summary,
		Classification: in.Classification,
		Diagnosis:      in.Diagnosis,
		IssueNumber:    in.IssueNumber,
		IssueURL:       in.IssueURL,
		IssueTitle:     in.IssueTitle,
		IssueExcerpt:   in.IssueExcerpt,
		Dispatched:     in.Dispatched,
		Recurrence:     int(in.Recurrence),
		Deployed:       in.Deployed,
		DeployedAt:     in.DeployedAt,
	}, nil
}
