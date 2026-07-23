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

// Package activityfeed is the projects domain's activity-feed slice: the two
// strict handlers behind the project overview's Agent Activity view (issue
// #239) — the paginated feed read and its SSE live tail.
package activityfeed

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
	"github.com/wso2/aep/aep-api/internal/projects"
)

// Handler serves list-activity and stream-activity on the strict interface.
type Handler struct{ svc *projects.ActivityService }

// New returns the slice's handler.
func New(svc *projects.ActivityService) *Handler { return &Handler{svc: svc} }

// ListActivity serves GET /projects/{projectName}/activity: a project's
// activity feed, newest first, cursor-paginated. The body is the feature's own
// view (projects.ActivityEvent marshaled verbatim) via a hand-written Visit —
// same escape hatch as the task list (delivery/task), so optional fields stay
// clean on the wire.
func (h *Handler) ListActivity(ctx context.Context, request gen.ListActivityRequestObject) (gen.ListActivityResponseObject, error) {
	if h.svc == nil {
		return nil, apierr.ServiceUnavailable("activity not configured")
	}
	org := tenant.BoundOrgFromContext(ctx)

	limit := int(request.Params.Limit)

	var beforeTime time.Time
	var beforeID string
	if request.Params.Before != "" {
		if t, err := time.Parse(time.RFC3339Nano, request.Params.Before); err == nil {
			beforeTime = t
			beforeID = request.Params.BeforeID
		}
	}

	rows, err := h.svc.List(ctx, org, request.ProjectName, limit, beforeTime, beforeID)
	if err != nil {
		return nil, apierr.Internal("failed to load activity")
	}
	return activityFeedResponse(rows), nil
}

// listActivityJSONResponse is the feed body + next-page cursor, marshaled
// verbatim (projects.ActivityEvent json tags already match the contract).
type listActivityJSONResponse struct {
	Items        []projects.ActivityEvent `json:"items"`
	NextBefore   string                   `json:"nextBefore,omitempty"`
	NextBeforeID string                   `json:"nextBeforeId,omitempty"`
}

// activityFeedResponse sets the next-page cursor to the oldest row returned
// (rows are newest-first, so that is the last element).
func activityFeedResponse(rows []projects.ActivityEvent) listActivityJSONResponse {
	out := listActivityJSONResponse{Items: rows}
	if n := len(rows); n > 0 {
		last := rows[n-1]
		out.NextBefore = last.OccurredAt.UTC().Format(time.RFC3339Nano)
		out.NextBeforeID = last.ID
	}
	return out
}

func (r listActivityJSONResponse) VisitListActivityResponse(w http.ResponseWriter) error {
	return writeJSONBody(w, http.StatusOK, r)
}

// StreamActivity serves GET /projects/{projectName}/activity/stream: the
// project's activity feed as SSE (replay + live tail). The loop runs inside the
// Visit method after the handler returns (the request ctx stays alive until the
// client disconnects).
func (h *Handler) StreamActivity(ctx context.Context, request gen.StreamActivityRequestObject) (gen.StreamActivityResponseObject, error) {
	if h.svc == nil {
		return nil, apierr.ServiceUnavailable("activity not configured")
	}
	org := tenant.BoundOrgFromContext(ctx)
	run := h.svc.OpenStream(ctx, org, request.ProjectName, request.Params.LastEventID)
	return activityStreamResponse{run: run}, nil
}

// activityStreamResponse adapts the connection loop onto the generated
// ResponseObject, same pattern as the task-log stream (delivery/execution).
type activityStreamResponse struct {
	run func(w io.Writer, flush func())
}

func (r activityStreamResponse) VisitStreamActivityResponse(w http.ResponseWriter) error {
	return sseStream(w, r.run)
}

// writeJSONBody is the slice-local JSON response writer (same shape as
// delivery/task's — each slice owns its escape-hatch writer).
func writeJSONBody(w http.ResponseWriter, status int, body any) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(body)
}

// sseStream stamps the standard SSE response preamble then hands the body
// writer + a per-chunk flush func to run (the strict-server re-home of
// humakit.SSEBody, same as delivery/execution's).
func sseStream(w http.ResponseWriter, run func(w io.Writer, flush func())) error {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flush := func() {
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}
	flush()
	run(w, flush)
	return nil
}
