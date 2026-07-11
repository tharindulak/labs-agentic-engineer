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

package handoff

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
)

// fakeIssueService records the org/project each call was scoped to and returns
// canned results. Only the two methods the ae_* issue tools use are meaningful;
// the rest satisfy the gitrepo.IssueService interface as no-ops.
type fakeIssueService struct {
	listIssues  []gitrepo.IssueInfo
	listErr     error
	createResp  *gitrepo.IssueResult
	createErr   error
	lastOrg     string
	lastProject string
	lastCreate  gitrepo.CreateIssueRequest
	lastLabels  []string
}

func (f *fakeIssueService) ListIssues(_ context.Context, org, project string, labels []string) ([]gitrepo.IssueInfo, error) {
	f.lastOrg, f.lastProject, f.lastLabels = org, project, labels
	return f.listIssues, f.listErr
}

func (f *fakeIssueService) CreateIssue(_ context.Context, org, project string, req gitrepo.CreateIssueRequest) (*gitrepo.IssueResult, error) {
	f.lastOrg, f.lastProject, f.lastCreate = org, project, req
	return f.createResp, f.createErr
}

func (f *fakeIssueService) GetIssue(context.Context, string, string, int) (*gitrepo.IssueInfo, error) {
	return nil, nil
}
func (f *fakeIssueService) CloseIssue(context.Context, string, string, int, string) error { return nil }
func (f *fakeIssueService) CommentIssue(context.Context, string, string, int, string) error {
	return nil
}
func (f *fakeIssueService) EditIssueBody(context.Context, string, string, int, string) error {
	return nil
}
func (f *fakeIssueService) EditIssueTitle(context.Context, string, string, int, string) error {
	return nil
}
func (f *fakeIssueService) AddLabels(context.Context, string, string, int, []string) error {
	return nil
}
func (f *fakeIssueService) RemoveLabel(context.Context, string, string, int, string) error {
	return nil
}
func (f *fakeIssueService) SetLabels(context.Context, string, string, int, []string) error {
	return nil
}
func (f *fakeIssueService) GetPullRequestState(context.Context, string, string, int) (*gitrepo.PullRequestState, error) {
	return nil, nil
}
func (f *fakeIssueService) MergePullRequest(context.Context, string, string, int) error { return nil }

// staticOrg is an OrgResolver that always resolves to org (ok=true), or fails
// closed when org is empty.
func staticOrg(org string) OrgResolver {
	return func(context.Context) (string, bool) {
		return org, org != ""
	}
}

// call POSTs a JSON-RPC body to the handler and returns the raw response.
func call(t *testing.T, h http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/sre-mcp", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// rpcResult decodes a 200 JSON-RPC envelope's result object.
func rpcResult(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Result map[string]any  `json:"result"`
		Error  *map[string]any `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v (body: %s)", err, rec.Body.String())
	}
	if env.Error != nil {
		t.Fatalf("unexpected JSON-RPC error: %+v", *env.Error)
	}
	return env.Result
}

// toolText returns the text block of a tools/call result and whether isError is set.
func toolText(t *testing.T, result map[string]any) (string, bool) {
	t.Helper()
	content, _ := result["content"].([]any)
	if len(content) == 0 {
		t.Fatalf("tools/call returned no content: %+v", result)
	}
	text, _ := content[0].(map[string]any)["text"].(string)
	isErr, _ := result["isError"].(bool)
	return text, isErr
}

func TestHandoff_ToolsList_ExactlyThreeAeTools(t *testing.T) {
	h := NewHandoffMCPHandler(&fakeIssueService{}, nil, staticOrg("org-1"))
	result := rpcResult(t, call(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	tools, _ := result["tools"].([]any)
	names := map[string]bool{}
	for _, raw := range tools {
		tool, _ := raw.(map[string]any)
		name, _ := tool["name"].(string)
		names[name] = true
	}
	want := map[string]bool{
		"ae_search_related_issues": true,
		"ae_create_issue":          true,
		"ae_dispatch_coding_agent": true,
	}
	if len(tools) != len(want) {
		t.Fatalf("tools/list returned %d tools, want %d (%v)", len(tools), len(want), names)
	}
	for name := range want {
		if !names[name] {
			t.Errorf("tools/list missing %q (got %v)", name, names)
		}
	}
}

func TestHandoff_Initialize_EchoesClientVersion(t *testing.T) {
	h := NewHandoffMCPHandler(&fakeIssueService{}, nil, staticOrg("org-1"))

	// client sends a modern version → echoed back
	result := rpcResult(t, call(t, h, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`))
	if result["protocolVersion"] != "2025-06-18" {
		t.Errorf("protocolVersion = %v, want echoed 2025-06-18", result["protocolVersion"])
	}
	info, _ := result["serverInfo"].(map[string]any)
	if info["name"] != "aep-handoff" {
		t.Errorf("serverInfo.name = %v, want aep-handoff", info["name"])
	}

	// no version → baseline default
	result = rpcResult(t, call(t, h, `{"jsonrpc":"2.0","id":2,"method":"initialize"}`))
	if result["protocolVersion"] != defaultProtocolVersion {
		t.Errorf("protocolVersion = %v, want default %s", result["protocolVersion"], defaultProtocolVersion)
	}
}

func TestHandoff_Notification_Returns202(t *testing.T) {
	h := NewHandoffMCPHandler(&fakeIssueService{}, nil, staticOrg("org-1"))
	rec := call(t, h, `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("notification status = %d, want 202", rec.Code)
	}
}

func TestHandoff_SearchRelatedIssues_ScopedAndRanked(t *testing.T) {
	svc := &fakeIssueService{listIssues: []gitrepo.IssueInfo{
		{Number: 1, Title: "checkout timeout", Body: "service1 slow"},
		{Number: 2, Title: "unrelated docs typo", Body: "readme"},
	}}
	h := NewHandoffMCPHandler(svc, nil, staticOrg("org-1"))

	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ae_search_related_issues","arguments":{"project":"proj-a","query":"timeout","labels":["bug"]}}}`
	text, isErr := toolText(t, rpcResult(t, call(t, h, body)))
	if isErr {
		t.Fatalf("unexpected tool error: %s", text)
	}
	if svc.lastOrg != "org-1" || svc.lastProject != "proj-a" {
		t.Errorf("ListIssues scoped to org=%q project=%q, want org-1/proj-a", svc.lastOrg, svc.lastProject)
	}
	if len(svc.lastLabels) != 1 || svc.lastLabels[0] != "bug" {
		t.Errorf("labels forwarded = %v, want [bug]", svc.lastLabels)
	}
	// "timeout" ranks the checkout issue and drops the unrelated one.
	if !strings.Contains(text, `"Title":"checkout timeout"`) {
		t.Errorf("result missing ranked match: %s", text)
	}
	if strings.Contains(text, "unrelated docs typo") {
		t.Errorf("non-matching issue should have been filtered out: %s", text)
	}
}

func TestHandoff_CreateIssue_ForwardsRequest(t *testing.T) {
	svc := &fakeIssueService{createResp: &gitrepo.IssueResult{Number: 42, URL: "https://gh/42", Deduped: true}}
	h := NewHandoffMCPHandler(svc, nil, staticOrg("org-1"))

	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ae_create_issue","arguments":{"project":"proj-a","title":"boom","body":"stack","labels":["incident"],"dedupeKey":"sre-rca/svc1"}}}`
	text, isErr := toolText(t, rpcResult(t, call(t, h, body)))
	if isErr {
		t.Fatalf("unexpected tool error: %s", text)
	}
	if svc.lastCreate.Title != "boom" || svc.lastCreate.Body != "stack" || svc.lastCreate.DedupeKey != "sre-rca/svc1" {
		t.Errorf("CreateIssueRequest forwarded = %+v", svc.lastCreate)
	}
	// Response marshals with the IssueResult json tags the SRE agent consumes.
	if !strings.Contains(text, `"number":42`) || !strings.Contains(text, `"deduped":true`) {
		t.Errorf("create result payload = %s", text)
	}
}

func TestHandoff_CreateIssue_ServiceErrorIsToolError(t *testing.T) {
	svc := &fakeIssueService{createErr: gitrepo.ErrRepoNotFound}
	h := NewHandoffMCPHandler(svc, nil, staticOrg("org-1"))

	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ae_create_issue","arguments":{"project":"proj-a","title":"t","body":"b"}}}`
	text, isErr := toolText(t, rpcResult(t, call(t, h, body)))
	if !isErr {
		t.Fatalf("expected isError tool result, got: %s", text)
	}
	if !strings.Contains(text, "create issue") {
		t.Errorf("tool error text = %q, want it to mention the failing op", text)
	}
}

func TestHandoff_OrgUnresolved_FailsClosed(t *testing.T) {
	h := NewHandoffMCPHandler(&fakeIssueService{}, nil, staticOrg("")) // resolver returns ok=false
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ae_create_issue","arguments":{"project":"p","title":"t","body":"b"}}}`
	text, isErr := toolText(t, rpcResult(t, call(t, h, body)))
	if !isErr || !strings.Contains(text, "org not resolved") {
		t.Fatalf("want org-fail-closed tool error, got isErr=%v text=%q", isErr, text)
	}
}

func TestHandoff_MissingProject_IsToolError(t *testing.T) {
	h := NewHandoffMCPHandler(&fakeIssueService{}, nil, staticOrg("org-1"))
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ae_create_issue","arguments":{"title":"t","body":"b"}}}`
	text, isErr := toolText(t, rpcResult(t, call(t, h, body)))
	if !isErr || !strings.Contains(text, "project") {
		t.Fatalf("want missing-project tool error, got isErr=%v text=%q", isErr, text)
	}
}

func TestHandoff_DispatchWithoutCommands_IsToolError(t *testing.T) {
	h := NewHandoffMCPHandler(&fakeIssueService{}, nil /* no task.Commands */, staticOrg("org-1"))
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ae_dispatch_coding_agent","arguments":{"project":"p","componentName":"c","title":"t","issueNumber":7,"issueUrl":"u"}}}`
	text, isErr := toolText(t, rpcResult(t, call(t, h, body)))
	if !isErr || !strings.Contains(text, "not configured") {
		t.Fatalf("want not-configured tool error, got isErr=%v text=%q", isErr, text)
	}
}

func TestHandoff_NilIssueService_503(t *testing.T) {
	h := NewHandoffMCPHandler(nil, nil, staticOrg("org-1"))
	rec := call(t, h, `{"jsonrpc":"2.0","id":1,"method":"initialize"}`)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 when issue service unconfigured", rec.Code)
	}
}

func TestHandoff_UnknownMethod_32601(t *testing.T) {
	h := NewHandoffMCPHandler(&fakeIssueService{}, nil, staticOrg("org-1"))
	rec := call(t, h, `{"jsonrpc":"2.0","id":1,"method":"resources/list"}`)
	var env struct {
		Error *jsonrpcError `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Error == nil || env.Error.Code != -32601 {
		t.Fatalf("want -32601 method not found, got %+v", env.Error)
	}
}
