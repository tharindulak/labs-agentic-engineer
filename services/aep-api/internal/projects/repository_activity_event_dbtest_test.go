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

package projects_test

import (
	"context"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/contracts/activityvocab"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
	"github.com/wso2/aep/aep-api/internal/projects"
)

// TestActivityEventRepository_InsertDedupAndList pins the write and read paths
// of the project activity feed (issue #239): Insert is idempotent on
// (org_id, project_id, dedup_key) — a duplicate is a no-op that reports
// inserted=false — and ListByProject returns newest-first with a keyset
// (occurred_at, id) cursor, scoped to one org+project.
func TestActivityEventRepository_InsertDedupAndList(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := projects.NewActivityEventRepository(db)
	ctx := context.Background()

	base := time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)
	mk := func(dedup string, at time.Time) *projects.ActivityEvent {
		return &projects.ActivityEvent{
			OrgID: "org1", ProjectID: "proj1", Type: activityvocab.TypeTaskDeployed,
			ActorKind: activityvocab.ActorAgent, ActorID: "build-agent", ActorName: "Build agent",
			Issue: 10, Title: "Catalog", DedupKey: dedup, OccurredAt: at,
		}
	}

	ins, err := repo.Insert(ctx, mk("exec:1:deployed", base))
	if err != nil || !ins {
		t.Fatalf("first insert: inserted=%v err=%v", ins, err)
	}
	ins, err = repo.Insert(ctx, mk("exec:1:deployed", base))
	if err != nil || ins {
		t.Fatalf("dup insert: inserted=%v err=%v (want false,nil)", ins, err)
	}
	if _, err := repo.Insert(ctx, mk("exec:2:deployed", base.Add(time.Minute))); err != nil {
		t.Fatalf("second insert: %v", err)
	}

	rows, err := repo.ListByProject(ctx, "org1", "proj1", 10, time.Time{}, "")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("want 2 rows, got %d", len(rows))
	}
	if !rows[0].OccurredAt.After(rows[1].OccurredAt) {
		t.Fatalf("want newest first, got %v then %v", rows[0].OccurredAt, rows[1].OccurredAt)
	}

	page, err := repo.ListByProject(ctx, "org1", "proj1", 10, rows[0].OccurredAt, rows[0].ID)
	if err != nil {
		t.Fatalf("list page: %v", err)
	}
	if len(page) != 1 || page[0].ID != rows[1].ID {
		t.Fatalf("cursor page wrong: %+v", page)
	}

	other, _ := repo.ListByProject(ctx, "org2", "proj1", 10, time.Time{}, "")
	if len(other) != 0 {
		t.Fatalf("cross-org leak: %d rows", len(other))
	}
}
