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
	"sync"
	"testing"
)

// recordedTurnActivity is one captured spec.TurnActivityRecorder call.
type recordedTurnActivity struct {
	orgID, projectID, turnID, title, actorEmail, actorName string
}

// captureTurnActivity collects recorder calls for assertion (issue #239).
type captureTurnActivity struct {
	mu   sync.Mutex
	rows []recordedTurnActivity
}

func (c *captureTurnActivity) RecordSpecUpdated(_ context.Context, orgID, projectID, turnID, title, actorEmail, actorName string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.rows = append(c.rows, recordedTurnActivity{orgID, projectID, turnID, title, actorEmail, actorName})
}

func (c *captureTurnActivity) all() []recordedTurnActivity {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]recordedTurnActivity(nil), c.rows...)
}

// A turn that lands a real commit records exactly one spec_updated line,
// actored by the prompting user and carrying the instruction subject.
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
	if got.actorEmail != "componenttest-user@users.noreply.aep.dev" {
		t.Errorf("actorEmail = %q, want the prompting user", got.actorEmail)
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
