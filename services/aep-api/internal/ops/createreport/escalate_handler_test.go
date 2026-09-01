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
	"errors"
	"testing"

	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/ops"
)

// fakeFiler records what the handler asked for and answers with a filed issue.
type fakeFiler struct {
	calls []filerCall
	res   ops.FiledIssue
	err   error
}

type filerCall struct {
	org, project, component, title, body, dedupeKey string
}

func (f *fakeFiler) FileAndDispatch(
	_ context.Context, org, project, component, title, body, dedupeKey string,
) (ops.FiledIssue, error) {
	f.calls = append(f.calls, filerCall{org, project, component, title, body, dedupeKey})
	if f.err != nil {
		return ops.FiledIssue{}, f.err
	}
	return f.res, nil
}

// declinedBody is the wire shape of a high-confidence decline that still names
// code-level actions — the case the platform must file for. It is report
// c82f1fb8, as the agent's own document rather than as a pre-mapped row: the
// end-to-end path now includes the derivation, so these tests exercise it.
func declinedBody() *gen.CreateRcaAgentReportRequest {
	return &gen.CreateRcaAgentReportRequest{Report: declinedNativeReport()}
}

func declinedNativeReport() map[string]any {
	return map[string]any{
		"summary": "service1 timed out waiting for service2.",
		"alert_context": map[string]any{
			"project":    "demo-developers-test-13",
			"component":  "demo-developers-test-13-service1",
			"alert_name": "service1 error rate",
		},
		"result": map[string]any{
			"root_causes": []any{
				map[string]any{
					"summary":    "service2 exceeded service1's idle timeout",
					"confidence": "high",
				},
			},
			"recommendations": map[string]any{
				"recommended_actions": []any{
					map[string]any{
						"description": "Update ReleaseBinding `svc1-development` env var " +
							"`IDLE_TIMEOUT` to at least 15s",
						"status": "revised",
					},
					map[string]any{
						"description": "Investigate and optimize service2's processing latency",
						"status":      "suggested",
					},
					map[string]any{
						"description": "Implement retry logic with exponential back-off in service1",
						"status":      "suggested",
					},
				},
			},
		},
		"handoff": map[string]any{"classification": "none"},
	}
}

func TestCreateReport_EscalatesHighConfidenceDecline(t *testing.T) {
	repo := &fakeRepo{}
	filer := &fakeFiler{res: ops.FiledIssue{Number: 11, URL: "https://gh/x/issues/11", Adopted: true}}
	h := New(repo).WithEscalator(filer)

	if _, err := h.CreateRcaAgentReport(ctxWithOrg("acme"),
		gen.CreateRcaAgentReportRequestObject{Body: declinedBody()}); err != nil {
		t.Fatalf("CreateRcaAgentReport: %v", err)
	}

	if len(filer.calls) != 1 {
		t.Fatalf("filed %d issues, want 1", len(filer.calls))
	}
	call := filer.calls[0]
	if call.org != "acme" || call.project != "demo-developers-test-13" {
		t.Errorf("filed against org/project %q/%q", call.org, call.project)
	}
	// The adopter rejects a project-prefixed component name, so the prefix has
	// to come off before the call, not inside it.
	if call.component != "service1" {
		t.Errorf("component = %q, want the unprefixed %q", call.component, "service1")
	}
	if call.dedupeKey == "" {
		t.Error("a dedupe key is required or a recurring alert files a new issue every time")
	}

	if len(repo.created) != 1 {
		t.Fatalf("persisted %d reports, want 1", len(repo.created))
	}
	got := repo.created[0]
	if got.IssueNumber == nil || *got.IssueNumber != 11 {
		t.Errorf("stored IssueNumber = %v, want 11 — the report must record what was filed", got.IssueNumber)
	}
	if got.IssueURL != "https://gh/x/issues/11" {
		t.Errorf("stored IssueURL = %q", got.IssueURL)
	}
	if !got.Dispatched {
		t.Error("an adopted issue means a coding agent has it — Dispatched must be true")
	}
}

// What proves the handoff filed is the issue NUMBER on the report, not its
// classification — a `code-level` report with no number means it judged code
// work was needed and then filed nothing, which is the case that must escalate.
func TestCreateReport_DoesNotEscalateWhenTheHandoffFiled(t *testing.T) {
	repo := &fakeRepo{}
	filer := &fakeFiler{res: ops.FiledIssue{Number: 99}}
	report := declinedNativeReport()
	report["handoff"] = map[string]any{
		"classification":       "code_level",
		"created_issue_number": float64(12),
		"adopted":              true,
	}
	body := &gen.CreateRcaAgentReportRequest{Report: report}

	if _, err := New(repo).WithEscalator(filer).CreateRcaAgentReport(ctxWithOrg("acme"),
		gen.CreateRcaAgentReportRequestObject{Body: body}); err != nil {
		t.Fatalf("CreateRcaAgentReport: %v", err)
	}
	if len(filer.calls) != 0 {
		t.Fatalf("must not file over the handoff's own issue, got %d calls", len(filer.calls))
	}
}

// Losing the report is the one outcome nothing recovers from, so a filing
// failure must not fail the write.
func TestCreateReport_PersistsWhenFilingFails(t *testing.T) {
	repo := &fakeRepo{}
	filer := &fakeFiler{err: errors.New("github: 502")}

	if _, err := New(repo).WithEscalator(filer).CreateRcaAgentReport(ctxWithOrg("acme"),
		gen.CreateRcaAgentReportRequestObject{Body: declinedBody()}); err != nil {
		t.Fatalf("a failed escalation must not fail the report write: %v", err)
	}
	if len(repo.created) != 1 {
		t.Fatalf("persisted %d reports, want 1", len(repo.created))
	}
	if repo.created[0].IssueNumber != nil {
		t.Error("no issue was filed, so the report must not claim one")
	}
}

// No escalator wired (a harness, or the feature switched off) leaves the old
// behaviour exactly as it was.
func TestCreateReport_NoEscalatorIsInert(t *testing.T) {
	repo := &fakeRepo{}
	if _, err := New(repo).CreateRcaAgentReport(ctxWithOrg("acme"),
		gen.CreateRcaAgentReportRequestObject{Body: declinedBody()}); err != nil {
		t.Fatalf("CreateRcaAgentReport: %v", err)
	}
	if len(repo.created) != 1 || repo.created[0].IssueNumber != nil {
		t.Fatal("without an escalator the report is stored unchanged")
	}
}

func TestUnprefixedComponent(t *testing.T) {
	t.Parallel()
	cases := []struct{ project, component, want string }{
		{"proj", "proj-service1", "service1"},
		{"proj", "service1", "service1"},      // already unprefixed
		{"proj", "", ""},                      // nothing to send
		{"proj", "proj", ""},                  // component IS the project: no component
		{"proj", "proj-a-proj-b", "a-proj-b"}, // strips only the leading prefix
	}
	for _, c := range cases {
		if got := unprefixedComponent(c.project, c.component); got != c.want {
			t.Errorf("unprefixedComponent(%q, %q) = %q, want %q", c.project, c.component, got, c.want)
		}
	}
}
