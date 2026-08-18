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

package issues

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// Handler serves create-issue and list-issues.
//
// These back external handoffs: the OpenChoreo SRE/RCA agent searches for related
// issues here and then files one, and filing is ALSO the dispatch — an issue
// created through this endpoint is adopted unless the caller opts out. See
// AE-HANDOFF-DESIGN.md (openchoreo/agents/sre-agent).
type Handler struct {
	issues  sourcecontrol.IssueService
	adopter sourcecontrol.Adopter
}

// New returns the slice's handler. issues may be nil, which degrades both ops to
// 503 — the component harness wires only what the feature under test needs. A nil
// adopter degrades create-issue to filing alone (see Adopter).
func New(issues sourcecontrol.IssueService, adopter sourcecontrol.Adopter) *Handler {
	return &Handler{issues: issues, adopter: adopter}
}

// CreateIssue files an issue and, by default, hands it to the coding agent.
//
// Adoption is the DEFAULT rather than an opt-in because the alternative was a
// silent dead end: an issue filed here with nothing to work it is a ledger entry
// that looks exactly like accepted work. A caller that wants that must now say
// so (adopt=false), and gets it named in the response either way.
func (h *Handler) CreateIssue(ctx context.Context, request gen.CreateIssueRequestObject) (gen.CreateIssueResponseObject, error) {
	if h.issues == nil {
		return nil, apierr.ServiceUnavailable("issue service not configured")
	}
	org := tenant.BoundOrgFromContext(ctx)

	req := sourcecontrol.CreateIssueRequest{
		Title:     request.Body.Title,
		Body:      request.Body.Body,
		Labels:    request.Body.Labels,
		DedupeKey: request.Body.DedupeKey,
	}

	// Absent means adopt: the pointer exists in the generated type precisely so
	// this default cannot be confused with an explicit false (contract note on
	// x-go-type-skip-optional-pointer).
	if h.adopter != nil && (request.Body.Adopt == nil || *request.Body.Adopt) {
		return h.createAdopted(ctx, org, request.ProjectName, request.Body.ComponentName, req)
	}

	issue, err := h.issues.CreateIssue(ctx, org, request.ProjectName, req)
	if err != nil {
		return nil, mapCreateError(err, "")
	}
	return gen.CreateIssue200JSONResponse(gen.IssueResult{
		Number:  int64(issue.Number),
		URL:     issue.URL,
		NodeID:  issue.NodeID,
		Deduped: issue.Deduped,
	}), nil
}

// createAdopted is the adopting half: one call that files the issue already in a
// milestone and already labelled, then starts or wakes the run.
func (h *Handler) createAdopted(
	ctx context.Context,
	org, project, componentName string,
	req sourcecontrol.CreateIssueRequest,
) (gen.CreateIssueResponseObject, error) {
	adoption, err := h.adopter.CreateAndAdopt(ctx, org, project, componentName, req)
	if err != nil {
		return nil, mapCreateError(err, componentName)
	}
	return gen.CreateIssue200JSONResponse(gen.IssueResult{
		Number:        int64(adoption.Issue.Number),
		URL:           adoption.Issue.URL,
		NodeID:        adoption.Issue.NodeID,
		Deduped:       adoption.Issue.Deduped,
		Adopted:       adoption.Adopted,
		AdoptionError: adoption.Reason,
	}), nil
}

// mapCreateError translates the create path's sentinels into the envelope.
//
// An unresolvable componentName is the caller's own bug — a project prefix left
// on the name is the one that keeps happening — so it is a 400 that names the
// component, not an opaque 500. Nothing was filed when it fires. The sentinel
// is worded for a component removed after generation; here the same condition
// means the name was never in the design, so the message is this path's own.
func mapCreateError(err error, componentName string) error {
	switch {
	case errors.Is(err, sourcecontrol.ErrRepoNotFound):
		return apierr.NotFound("project repo not found")
	case errors.Is(err, spec.ErrComponentRemovedAfterGeneration):
		return apierr.BadRequest(fmt.Sprintf(
			"componentName %q is not a component of this project's design — pass the design name, unprefixed",
			componentName))
	default:
		return apierr.Internal("failed to create issue")
	}
}

func (h *Handler) ListIssues(ctx context.Context, request gen.ListIssuesRequestObject) (gen.ListIssuesResponseObject, error) {
	if h.issues == nil {
		return nil, apierr.ServiceUnavailable("issue service not configured")
	}
	org := tenant.BoundOrgFromContext(ctx)

	issues, err := h.issues.ListIssues(ctx, org, request.ProjectName, splitLabels(request.Params.Labels))
	if err != nil {
		if errors.Is(err, sourcecontrol.ErrRepoNotFound) {
			return nil, apierr.NotFound("project repo not found")
		}
		return nil, apierr.Internal("failed to list issues")
	}

	ranked := sourcecontrol.RankIssuesByQuery(issues, request.Params.Q)
	out := make([]gen.IssueInfo, 0, len(ranked))
	for _, iss := range ranked {
		out = append(out, gen.IssueInfo{
			Number: int64(iss.Number),
			Title:  iss.Title,
			Body:   iss.Body,
			URL:    iss.URL,
			State:  iss.State,
			Labels: iss.Labels,
		})
	}
	return gen.ListIssues200JSONResponse(out), nil
}

// splitLabels parses the comma-separated `labels` query param, dropping blanks.
func splitLabels(param string) []string {
	if param == "" {
		return nil
	}
	var labels []string
	for _, l := range strings.Split(param, ",") {
		if l = strings.TrimSpace(l); l != "" {
			labels = append(labels, l)
		}
	}
	return labels
}
