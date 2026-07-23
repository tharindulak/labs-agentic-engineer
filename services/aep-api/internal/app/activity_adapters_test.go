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

package app

import (
	"context"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/contracts/activityvocab"
	"github.com/wso2/aep/aep-api/internal/projects"
)

// captureActivityRepo records every inserted event so the adapter tests can
// assert who ended up on the feed. Never a duplicate (inserted=true always).
type captureActivityRepo struct{ rows []*projects.ActivityEvent }

func (r *captureActivityRepo) Insert(_ context.Context, row *projects.ActivityEvent) (bool, error) {
	r.rows = append(r.rows, row)
	return true, nil
}

func (r *captureActivityRepo) ListByProject(context.Context, string, string, int, time.Time, string) ([]projects.ActivityEvent, error) {
	return nil, nil
}

// newRecorders wires a turn + files recorder over a shared authorship coordinator
// and a capturing service, exactly as app.go composes them.
func newRecorders() (turnActivityRecorder, filesActivityRecorder, *captureActivityRepo) {
	repo := &captureActivityRepo{}
	svc := projects.NewActivityService(repo, projects.NewActivityHub())
	authored := &specAuthorship{}
	return turnActivityRecorder{svc: svc, authorship: authored},
		filesActivityRecorder{svc: svc, authorship: authored},
		repo
}

// The core issue #239 fix: an agent room turn records the agent line, and the
// committer's later files/apply flush of that same doc is suppressed (not a
// second, mis-attributed "user updated the spec" line).
func TestSpecAuthorship_AgentTurnThenFlush_OneAgentLine(t *testing.T) {
	turn, files, repo := newRecorders()

	turn.RecordSpecUpdated(context.Background(), "acme", "web", "turn-1", "add a gym tracker", []string{"specs/requirements/requirements.md"})
	files.RecordSpecUpdated(context.Background(), "acme", "web", "commit-sha-abc", []string{"specs/requirements/requirements.md"})

	if len(repo.rows) != 1 {
		t.Fatalf("recorded rows = %d, want 1 (agent line only, flush suppressed): %+v", len(repo.rows), repo.rows)
	}
	got := repo.rows[0]
	if got.ActorKind != activityvocab.ActorAgent || got.ActorName != "Spec agent" {
		t.Errorf("actor = (%q, %q), want the agent", got.ActorKind, got.ActorName)
	}
	if got.Type != activityvocab.TypeSpecUpdated || got.Title != "add a gym tracker" {
		t.Errorf("event = (%q, %q), want spec_updated with the instruction subject", got.Type, got.Title)
	}
	if got.DedupKey != "turn:turn-1:committed" {
		t.Errorf("dedupKey = %q, want the turn key", got.DedupKey)
	}
}

// A genuine manual edit (no preceding agent turn) still reaches the feed as the
// signed-in user — the "Both agent + manual" attribution the product wants.
func TestSpecAuthorship_ManualFlush_RecordsUser(t *testing.T) {
	_, files, repo := newRecorders()

	files.RecordSpecUpdated(context.Background(), "acme", "web", "commit-sha-manual", []string{"specs/requirements/requirements.md"})

	if len(repo.rows) != 1 {
		t.Fatalf("recorded rows = %d, want 1 (manual user edit): %+v", len(repo.rows), repo.rows)
	}
	got := repo.rows[0]
	if got.ActorKind != activityvocab.ActorUser {
		t.Errorf("actorKind = %q, want user (manual edit)", got.ActorKind)
	}
	if got.DedupKey != "apply:commit-sha-manual" {
		t.Errorf("dedupKey = %q, want the apply key", got.DedupKey)
	}
}

// Marks are per PATH, not per project: the committer holds agent-marked
// markdown until the session-end force flush, so a user's own edit can land in
// an interim commit BETWEEN the agent turn and the agent flush. That disjoint
// commit must record as the user, and the agent's flush — landing after it —
// must still be suppressed. (With a project-wide mark both halves inverted:
// the user's line vanished and the agent's commit recorded as the user.)
func TestSpecAuthorship_UserFlushBetweenTurnAndAgentFlush(t *testing.T) {
	turn, files, repo := newRecorders()

	turn.RecordSpecUpdated(context.Background(), "acme", "web", "turn-1", "add a gym tracker", []string{"specs/requirements/requirements.md"})
	// Interim debounce flush: only the user's hand-edited file (the agent's
	// markdown is still held pending review).
	files.RecordSpecUpdated(context.Background(), "acme", "web", "commit-user", []string{"specs/design/design.json"})
	// Session-end force flush finally lands the agent's markdown.
	files.RecordSpecUpdated(context.Background(), "acme", "web", "commit-agent", []string{"specs/requirements/requirements.md"})

	if len(repo.rows) != 2 {
		t.Fatalf("recorded rows = %d, want 2 (agent turn + user's own edit): %+v", len(repo.rows), repo.rows)
	}
	if repo.rows[0].ActorKind != activityvocab.ActorAgent {
		t.Errorf("row 0 actor = %q, want agent", repo.rows[0].ActorKind)
	}
	if repo.rows[1].ActorKind != activityvocab.ActorUser || repo.rows[1].DedupKey != "apply:commit-user" {
		t.Errorf("row 1 = (%q, %q), want the user's interim edit as user", repo.rows[1].ActorKind, repo.rows[1].DedupKey)
	}
}

// The mark is consumed exactly once: after the agent's paths land, a second
// flush touching the same path is a genuine manual edit and records the user
// (the mark does not linger and swallow later real edits).
func TestSpecAuthorship_MarkConsumedOnce(t *testing.T) {
	turn, files, repo := newRecorders()

	turn.RecordSpecUpdated(context.Background(), "acme", "web", "turn-1", "add a gym tracker", []string{"specs/requirements/requirements.md"})
	files.RecordSpecUpdated(context.Background(), "acme", "web", "commit-1", []string{"specs/requirements/requirements.md"}) // agent flush — suppressed
	files.RecordSpecUpdated(context.Background(), "acme", "web", "commit-2", []string{"specs/requirements/requirements.md"}) // later manual edit — user

	if len(repo.rows) != 2 {
		t.Fatalf("recorded rows = %d, want 2 (agent turn + later manual edit): %+v", len(repo.rows), repo.rows)
	}
	if repo.rows[0].ActorKind != activityvocab.ActorAgent {
		t.Errorf("row 0 actor = %q, want agent", repo.rows[0].ActorKind)
	}
	if repo.rows[1].ActorKind != activityvocab.ActorUser || repo.rows[1].DedupKey != "apply:commit-2" {
		t.Errorf("row 1 = (%q, %q), want the later manual edit as user", repo.rows[1].ActorKind, repo.rows[1].DedupKey)
	}
}

// A committed (non-room) turn passes no paths: it lands its own commit, so
// nothing is marked and a user's next apply — even to the same file — records
// as the user.
func TestSpecAuthorship_CommittedTurnMarksNothing(t *testing.T) {
	turn, files, repo := newRecorders()

	turn.RecordSpecUpdated(context.Background(), "acme", "web", "turn-1", "add a gym tracker", nil)
	files.RecordSpecUpdated(context.Background(), "acme", "web", "commit-manual", []string{"specs/requirements/requirements.md"})

	if len(repo.rows) != 2 {
		t.Fatalf("recorded rows = %d, want 2 (agent turn + manual edit): %+v", len(repo.rows), repo.rows)
	}
	if repo.rows[1].ActorKind != activityvocab.ActorUser {
		t.Errorf("row 1 actor = %q, want user (no mark from a committed turn)", repo.rows[1].ActorKind)
	}
}

// The mark is scoped per (org, project): an agent turn in one project does not
// suppress a manual edit to the same path in another.
func TestSpecAuthorship_ScopedPerProject(t *testing.T) {
	turn, files, repo := newRecorders()

	turn.RecordSpecUpdated(context.Background(), "acme", "web", "turn-1", "add a gym tracker", []string{"specs/requirements/requirements.md"})
	files.RecordSpecUpdated(context.Background(), "acme", "other", "commit-other", []string{"specs/requirements/requirements.md"})

	if len(repo.rows) != 2 {
		t.Fatalf("recorded rows = %d, want 2 (agent in web + user in other): %+v", len(repo.rows), repo.rows)
	}
	if repo.rows[1].ProjectID != "other" || repo.rows[1].ActorKind != activityvocab.ActorUser {
		t.Errorf("row 1 = (%q, %q), want the other project's manual edit as user", repo.rows[1].ProjectID, repo.rows[1].ActorKind)
	}
}
