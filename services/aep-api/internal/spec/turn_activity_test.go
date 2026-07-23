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

package spec_test

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"testing"
)

// startCollabTurn POSTs a room-scoped (collab: true) turn and returns its id.
// The requirements-chat useCase is the one the Spec view authors design.json
// under; collab makes the agents service a live peer that writes into the doc
// rather than committing to git.
func (r *genaiRig) startCollabTurn(t *testing.T, uuid, instruction string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"useCase":     "requirements-chat",
		"instruction": instruction,
		"collab":      true,
	})
	rec := r.h.AsOrg(testOrg).Post(turnsPath(uuid), string(body))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("POST collab turn: code %d, want 202 (%s)", rec.Code, rec.Body.String())
	}
	var out struct {
		TurnID string `json:"turnId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || out.TurnID == "" {
		t.Fatalf("202 body = %s (err %v)", rec.Body.String(), err)
	}
	return out.TurnID
}

// recordedTurnActivity is one captured spec.TurnActivityRecorder call.
type recordedTurnActivity struct {
	orgID, projectID, turnID, title string
	editedPaths                     []string
}

// captureTurnActivity collects recorder calls for assertion (issue #239).
type captureTurnActivity struct {
	mu   sync.Mutex
	rows []recordedTurnActivity
}

func (c *captureTurnActivity) RecordSpecUpdated(_ context.Context, orgID, projectID, turnID, title string, editedPaths []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.rows = append(c.rows, recordedTurnActivity{orgID, projectID, turnID, title, editedPaths})
}

func (c *captureTurnActivity) all() []recordedTurnActivity {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]recordedTurnActivity(nil), c.rows...)
}

// A turn that lands a real commit records exactly one spec_updated line,
// carrying the instruction subject. The actor is the agent (decided by the
// app-root adapter), so no user identity is threaded here.
func TestTurnActivity_RecordedOnCommit(t *testing.T) {
	rec := &captureTurnActivity{}
	r := newGenaiRig(t, map[string]string{"specs/requirements/requirements.md": "# Reqs\n"}, withRecorder(rec))

	final := map[string]string{"specs/requirements/requirements.md": "# Requirements\n"}
	r.fake.parts = []string{
		editFilePart("specs/requirements/requirements.md", "# Reqs\n", "# Requirements\n"),
	}
	m := manifestPart(final, nil)
	r.fake.manifest = &m

	turnID := r.startTurn(t, convUUID, "requirements-chat", "tidy the requirements")
	st := r.waitTerminal(t, turnID)
	if st.Status != "completed" || st.NoChanges {
		t.Fatalf("terminal = %+v, want completed with changes", st)
	}

	rows := rec.all()
	if len(rows) != 1 {
		t.Fatalf("recorded rows = %d, want 1: %+v", len(rows), rows)
	}
	got := rows[0]
	if got.orgID != testOrg || got.projectID != testProj {
		t.Errorf("scope = (%q, %q), want (%q, %q)", got.orgID, got.projectID, testOrg, testProj)
	}
	if got.turnID != turnID {
		t.Errorf("turnID = %q, want %q", got.turnID, turnID)
	}
	if got.title != "tidy the requirements" {
		t.Errorf("title = %q, want the instruction subject", got.title)
	}
}

// A room-scoped turn commits nothing (the collab doc is the write surface), yet
// it is the only place the agent's authorship is knowable — the committer's
// later flush lands under the user's token. So a room turn whose agent edited
// the doc still records the agent's spec_updated line (issue #239). This is the
// regression that made the Spec view show only "Admin updated the spec".
func TestTurnActivity_RoomScopedTurnRecordsAgentEdit(t *testing.T) {
	rec := &captureTurnActivity{}
	r := newGenaiRig(t, map[string]string{"specs/requirements/requirements.md": "# Reqs\n"}, withRecorder(rec))

	r.fake.parts = []string{
		editFilePart("requirements/requirements.md", "# Reqs\n", "# Requirements\n"),
	}
	m := manifestPart(map[string]string{"requirements/requirements.md": "# Requirements\n"}, nil)
	r.fake.manifest = &m

	turnID := r.startCollabTurn(t, convUUID, "add a gym tracker web app")
	st := r.waitTerminal(t, turnID)
	if st.Status != "completed" || !st.NoChanges {
		t.Fatalf("terminal = %+v, want completed no-changes (room turn never commits)", st)
	}

	rows := rec.all()
	if len(rows) != 1 {
		t.Fatalf("recorded rows = %d, want 1 (agent doc edit): %+v", len(rows), rows)
	}
	if rows[0].turnID != turnID || rows[0].title != "add a gym tracker web app" {
		t.Errorf("row = %+v, want the turn's id + instruction subject", rows[0])
	}
	// The manifest's paths ride along so the app-root authorship coordinator
	// can suppress the committer's later flush of exactly these files.
	if len(rows[0].editedPaths) != 1 || rows[0].editedPaths[0] != "requirements/requirements.md" {
		t.Errorf("editedPaths = %v, want the manifest's mutated path", rows[0].editedPaths)
	}
}

// A room-scoped turn whose agent edited nothing (empty manifest — a pure chat
// reply) records no line.
func TestTurnActivity_RoomScopedNoEditsRecordsNothing(t *testing.T) {
	rec := &captureTurnActivity{}
	r := newGenaiRig(t, map[string]string{"specs/requirements/requirements.md": "# Reqs\n"}, withRecorder(rec))

	r.fake.parts = []string{textPart("just answering your question")}
	m := manifestPart(map[string]string{}, nil)
	r.fake.manifest = &m

	turnID := r.startCollabTurn(t, convUUID, "what does this project do?")
	st := r.waitTerminal(t, turnID)
	if st.Status != "completed" || !st.NoChanges {
		t.Fatalf("terminal = %+v, want completed no-changes", st)
	}
	if rows := rec.all(); len(rows) != 0 {
		t.Fatalf("recorded rows = %+v, want none (no doc edits)", rows)
	}
}

// A completed turn that changes nothing records no line.
func TestTurnActivity_NoChangesRecordsNothing(t *testing.T) {
	rec := &captureTurnActivity{}
	r := newGenaiRig(t, map[string]string{"specs/requirements/requirements.md": "# Reqs\n"}, withRecorder(rec))

	r.fake.parts = []string{textPart("nothing to do")}
	m := manifestPart(map[string]string{}, nil)
	r.fake.manifest = &m

	turnID := r.startTurn(t, convUUID, "requirements-chat", "no-op request")
	st := r.waitTerminal(t, turnID)
	if st.Status != "completed" || !st.NoChanges {
		t.Fatalf("terminal = %+v, want completed no-changes", st)
	}
	if rows := rec.all(); len(rows) != 0 {
		t.Fatalf("recorded rows = %+v, want none", rows)
	}
}
