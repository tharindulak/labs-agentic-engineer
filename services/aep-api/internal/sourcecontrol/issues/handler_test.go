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
	"testing"

	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// Only CreateIssue and CreateAndAdopt are reached; the rest of each port is
// embedded so an accidental call panics rather than quietly returning a zero.
type fakeIssues struct {
	sourcecontrol.IssueService
	got sourcecontrol.CreateIssueRequest
}

func (f *fakeIssues) CreateIssue(
	_ context.Context, _, _ string, req sourcecontrol.CreateIssueRequest,
) (*sourcecontrol.IssueResult, error) {
	f.got = req
	return &sourcecontrol.IssueResult{Number: 7, URL: "u", NodeID: "n"}, nil
}

type fakeAdopter struct {
	called bool
	got    sourcecontrol.CreateIssueRequest
}

func (f *fakeAdopter) CreateAndAdopt(
	_ context.Context, _, _, _ string, req sourcecontrol.CreateIssueRequest,
) (*sourcecontrol.Adoption, error) {
	f.called = true
	f.got = req
	return &sourcecontrol.Adoption{
		Issue:   &sourcecontrol.IssueResult{Number: 7, URL: "u", NodeID: "n"},
		Adopted: true,
	}, nil
}

func statuses(values ...string) []*string {
	out := make([]*string, 0, len(values))
	for _, value := range values {
		status := value
		out = append(out, &status)
	}
	return out
}

func createIssue(t *testing.T, body gen.CreateIssueJSONRequestBody) (
	*fakeIssues, *fakeAdopter, gen.IssueResult,
) {
	t.Helper()
	issueSvc := &fakeIssues{}
	adopter := &fakeAdopter{}
	resp, err := New(issueSvc, adopter).CreateIssue(
		context.Background(),
		gen.CreateIssueRequestObject{ProjectName: "p", Body: &body},
	)
	if err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}
	return issueSvc, adopter, gen.IssueResult(resp.(gen.CreateIssue200JSONResponse))
}

// Configuration already expressed every action, so the issue is a ledger entry:
// filed, answered with its classification, and never handed to a coding agent.
func TestCreateIssueFilesConfigLevelWithoutAdopting(t *testing.T) {
	issueSvc, adopter, result := createIssue(t, gen.CreateIssueJSONRequestBody{
		Title:          "t",
		Body:           "b",
		DedupeKey:      "sre-rca/service1/abc",
		ActionStatuses: statuses("revised", "applied"),
	})

	if adopter.called {
		t.Error("config-level must not be adopted")
	}
	if result.Classification != "config-level" {
		t.Errorf("classification = %q, want config-level", result.Classification)
	}
	// Left open and unworked, it would otherwise absorb a later code-level
	// incident on the same signature.
	if issueSvc.got.DedupeKey != "sre-rca/service1/abc/config" {
		t.Errorf("dedupeKey = %q, want the config namespace", issueSvc.got.DedupeKey)
	}
}

func TestCreateIssueAdoptsCodeLevelAndLeavesTheDedupeKeyAlone(t *testing.T) {
	_, adopter, result := createIssue(t, gen.CreateIssueJSONRequestBody{
		Title:          "t",
		Body:           "b",
		DedupeKey:      "sre-rca/service1/abc",
		ActionStatuses: statuses("suggested"),
	})

	if !adopter.called {
		t.Error("code-level must be adopted")
	}
	if result.Classification != "code-level" {
		t.Errorf("classification = %q, want code-level", result.Classification)
	}
	if adopter.got.DedupeKey != "sre-rca/service1/abc" {
		t.Errorf("dedupeKey = %q, want it unchanged", adopter.got.DedupeKey)
	}
}

// An action the remediation agent never reached is PENDING work, so it adopts.
// The remediation stage is off by default, which makes this the ordinary shape
// on a fresh install rather than an edge case.
func TestCreateIssueTreatsANullStatusAsPendingCodeWork(t *testing.T) {
	_, adopter, result := createIssue(t, gen.CreateIssueJSONRequestBody{
		Title:          "t",
		Body:           "b",
		ActionStatuses: []*string{nil},
	})

	if !adopter.called {
		t.Error("a null status must still be adopted")
	}
	if result.Classification != "code-level" {
		t.Errorf("classification = %q, want code-level", result.Classification)
	}
}

// A caller with no RCA report behind it keeps today's behaviour exactly: it
// adopts by default, its dedupe key is untouched, and no classification is
// invented for it.
func TestCreateIssueLeavesACallerWithoutStatusesAlone(t *testing.T) {
	_, adopter, result := createIssue(t, gen.CreateIssueJSONRequestBody{
		Title:     "t",
		Body:      "b",
		DedupeKey: "manual/key",
	})

	if !adopter.called {
		t.Error("a caller without statuses must keep adopting by default")
	}
	if result.Classification != "" {
		t.Errorf("classification = %q, want it omitted", result.Classification)
	}
	if adopter.got.DedupeKey != "manual/key" {
		t.Errorf("dedupeKey = %q, want it unchanged", adopter.got.DedupeKey)
	}
}

func TestCreateIssueHonoursAnExplicitOptOut(t *testing.T) {
	optOut := false
	_, adopter, _ := createIssue(t, gen.CreateIssueJSONRequestBody{
		Title:          "t",
		Body:           "b",
		Adopt:          &optOut,
		ActionStatuses: statuses("suggested"),
	})

	if adopter.called {
		t.Error("the classification must never widen adoption past the caller's opt-out")
	}
}
