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

package activityfeed

import (
	"context"
	"testing"
	"time"

	"errors"

	"github.com/wso2/aep/aep-api/internal/contracts/activityvocab"
	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
	"github.com/wso2/aep/aep-api/internal/projects"
)

// fakeActivityRepo is a DB-free stand-in for projects.ActivityRepository: List
// returns canned rows (newest-first, as the real repository does); Insert is
// unused by the read path but must exist to satisfy the interface.
type fakeActivityRepo struct {
	rows []projects.ActivityEvent
}

func (f *fakeActivityRepo) Insert(_ context.Context, _ *projects.ActivityEvent) (bool, error) {
	return true, nil
}

func (f *fakeActivityRepo) ListByProject(_ context.Context, _, _ string, _ int, _ time.Time, _ string) ([]projects.ActivityEvent, error) {
	return f.rows, nil
}

// TestListActivity_ordersItemsAndSetsNextCursor pins the handler's contract:
// items come back in exactly the order the service returned them (newest
// first), and the next-page cursor is the last (oldest) row's occurredAt/id —
// no DB, no HTTP transport, just the strict-server method directly.
func TestListActivity_ordersItemsAndSetsNextCursor(t *testing.T) {
	t.Parallel()

	newest := projects.ActivityEvent{
		ID: "evt-2", Type: activityvocab.TypeTaskDeployed,
		ActorKind: activityvocab.ActorAgent, ActorName: "Build agent",
		OccurredAt: time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC),
	}
	oldest := projects.ActivityEvent{
		ID: "evt-1", Type: activityvocab.TypeTaskStarted,
		ActorKind: activityvocab.ActorAgent, ActorName: "Build agent",
		OccurredAt: time.Date(2026, 7, 17, 11, 0, 0, 0, time.UTC),
	}
	repo := &fakeActivityRepo{rows: []projects.ActivityEvent{newest, oldest}}
	svc := projects.NewActivityService(repo, projects.NewActivityHub())

	h := New(svc)
	ctx := tenant.WithBoundOrg(context.Background(), "org1")

	resp, err := h.ListActivity(ctx, gen.ListActivityRequestObject{
		ProjectName: "proj1",
		Params:      gen.ListActivityParams{},
	})
	if err != nil {
		t.Fatalf("ListActivity: unexpected error %v", err)
	}

	body, ok := resp.(listActivityJSONResponse)
	if !ok {
		t.Fatalf("ListActivity response type = %T, want listActivityJSONResponse", resp)
	}
	if len(body.Items) != 2 || body.Items[0].ID != "evt-2" || body.Items[1].ID != "evt-1" {
		t.Fatalf("items out of order: %+v", body.Items)
	}
	wantNextBefore := oldest.OccurredAt.UTC().Format(time.RFC3339Nano)
	if body.NextBefore != wantNextBefore {
		t.Fatalf("NextBefore = %q, want %q", body.NextBefore, wantNextBefore)
	}
	if body.NextBeforeID != oldest.ID {
		t.Fatalf("NextBeforeID = %q, want %q", body.NextBeforeID, oldest.ID)
	}
}

// TestListActivity_emptyFeed_noCursor asserts the empty-page edge: no rows
// means no next-page cursor is emitted.
func TestListActivity_emptyFeed_noCursor(t *testing.T) {
	t.Parallel()

	repo := &fakeActivityRepo{}
	svc := projects.NewActivityService(repo, projects.NewActivityHub())
	h := New(svc)
	ctx := tenant.WithBoundOrg(context.Background(), "org1")

	resp, err := h.ListActivity(ctx, gen.ListActivityRequestObject{
		ProjectName: "proj1",
		Params:      gen.ListActivityParams{},
	})
	if err != nil {
		t.Fatalf("ListActivity: unexpected error %v", err)
	}
	body := resp.(listActivityJSONResponse)
	if len(body.Items) != 0 {
		t.Fatalf("Items = %+v, want empty", body.Items)
	}
	if body.NextBefore != "" || body.NextBeforeID != "" {
		t.Fatalf("expected no cursor on an empty page, got NextBefore=%q NextBeforeID=%q", body.NextBefore, body.NextBeforeID)
	}
}

// TestListActivity_nilService_serviceUnavailable pins the nil-guard: an
// unconfigured ActivitySvc must 503, never panic.
func TestListActivity_nilService_serviceUnavailable(t *testing.T) {
	t.Parallel()

	h := New(nil)
	ctx := tenant.WithBoundOrg(context.Background(), "org1")

	_, err := h.ListActivity(ctx, gen.ListActivityRequestObject{ProjectName: "proj1"})
	if err == nil {
		t.Fatal("expected an error with ActivitySvc unconfigured")
	}
	var apiErr *apierr.Error
	if !errors.As(err, &apiErr) || apiErr.Status != 503 {
		t.Fatalf("error = %v, want apierr 503", err)
	}
}
