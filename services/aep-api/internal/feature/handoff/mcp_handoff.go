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

// Package handoff hosts the SRE handoff MCP surface (POST /sre-mcp). It is the
// in-process successor to the standalone services/aep-mcp-server TypeScript
// bridge: the OpenChoreo SRE/RCA agent connects here as an MCP client and its
// LLM calls the ae_* tools to file a GitHub issue (searching for a related one
// first) and dispatch the AE coding agent against it.
//
// Unlike the design-time discovery surface (dependencies/mcp_server.go, which is
// gated by a BFF-signed aep-api-mcp token and reads the org from the ocOrgId
// claim), this surface is mounted behind the SAME public-edge jwt + ensureOrg
// middleware the REST endpoints use, so the SRE agent authenticates with the
// exact same Thunder token (aud openchoreo-rca-agent) it already presents — the
// merge preserves that boundary rather than introducing a new token flow. The
// acting org is resolved from the verified claims via the injected OrgResolver;
// it is NEVER read from the request path/body/header. Because the ae_* tools file
// issues through the org's own GitHub installation credential (resolved inside
// IssueService / task.Commands), they do NOT run under a service identity — the
// same posture as the REST handlers they replace.
//
// The JSON-RPC transport here is deliberately self-contained (a small copy of
// the Streamable-HTTP, single-response form used by dependencies/mcp_server.go)
// so the discovery server's code is left entirely untouched by this merge.
package handoff

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/feature/task"
)

// defaultProtocolVersion is the MCP protocol version advertised when the client
// does not request one. When the client's initialize DOES carry a
// protocolVersion we echo it back (a modern Streamable-HTTP client negotiates a
// newer revision than this hand-rolled server's baseline); the JSON-RPC method
// set is version-agnostic, so agreeing on the client's revision is safe and
// maximises interoperability with the SRE agent's langchain-mcp-adapters client.
const defaultProtocolVersion = "2024-11-05"

// OrgResolver derives the acting org handle from the request context (the
// verified JWT claims bound by the auth middleware). ok is false when no org
// could be resolved — the handler then fails closed rather than acting org-less.
// The mount site injects auth.ResolveOuHandle(auth.ClaimsFromContext(ctx)); this
// package takes a func so it need not depend on the api wiring.
type OrgResolver func(ctx context.Context) (org string, ok bool)

type jsonrpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"` // absent for notifications
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type jsonrpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *jsonrpcError   `json:"error,omitempty"`
}

type jsonrpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// handoffHandler holds the in-process ports the ae_* tools call.
type handoffHandler struct {
	issues gitrepo.IssueService
	cmds   *task.Commands
	orgOf  OrgResolver
}

// NewHandoffMCPHandler returns the JSON-RPC MCP handler for the SRE handoff
// tools over the issue service and the task command surface. A nil issue
// service makes the surface unavailable (503 — it is the core catalog). A nil
// task.Commands degrades only ae_dispatch_coding_agent to a tool error. A nil
// OrgResolver is a wiring bug and fails every tool call closed (401-equivalent
// tool error).
func NewHandoffMCPHandler(issues gitrepo.IssueService, cmds *task.Commands, orgOf OrgResolver) http.Handler {
	h := &handoffHandler{issues: issues, cmds: cmds, orgOf: orgOf}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h.issues == nil {
			http.Error(w, "issue service not configured", http.StatusServiceUnavailable)
			return
		}

		var req jsonrpcRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeRPCError(w, nil, -32700, "parse error")
			return
		}

		// Notifications (no id) get a 202 with no body — e.g. notifications/initialized.
		if len(req.ID) == 0 {
			w.WriteHeader(http.StatusAccepted)
			return
		}

		switch req.Method {
		case "initialize":
			writeRPCResult(w, req.ID, map[string]any{
				"protocolVersion": negotiateVersion(req.Params),
				"capabilities":    map[string]any{"tools": map[string]any{}},
				"serverInfo":      map[string]any{"name": "aep-handoff", "version": "1.0.0"},
			})
		case "ping":
			writeRPCResult(w, req.ID, map[string]any{})
		case "tools/list":
			writeRPCResult(w, req.ID, map[string]any{"tools": handoffTools()})
		case "tools/call":
			h.handleToolCall(w, r, req)
		default:
			writeRPCError(w, req.ID, -32601, "method not found: "+req.Method)
		}
	})
}

// negotiateVersion echoes the client's requested protocolVersion when it sends
// one, else falls back to the baseline. See defaultProtocolVersion.
func negotiateVersion(params json.RawMessage) string {
	var p struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	if len(params) > 0 {
		_ = json.Unmarshal(params, &p)
	}
	if p.ProtocolVersion != "" {
		return p.ProtocolVersion
	}
	return defaultProtocolVersion
}

// handleToolCall resolves the acting org from the verified claims, then
// dispatches the tools/call to the matching in-process port. The org is read
// SOLELY from the context (bound by the auth middleware) — never from the
// tool arguments.
func (h *handoffHandler) handleToolCall(w http.ResponseWriter, r *http.Request, req jsonrpcRequest) {
	var call struct {
		Name      string `json:"name"`
		Arguments struct {
			Project       string   `json:"project"`
			Query         string   `json:"query"`
			Labels        []string `json:"labels"`
			Title         string   `json:"title"`
			Body          string   `json:"body"`
			DedupeKey     string   `json:"dedupeKey"`
			ComponentName string   `json:"componentName"`
			IssueNumber   int      `json:"issueNumber"`
			IssueURL      string   `json:"issueUrl"`
		} `json:"arguments"`
	}
	if err := json.Unmarshal(req.Params, &call); err != nil {
		writeRPCError(w, req.ID, -32602, "invalid params")
		return
	}

	org, ok := h.orgOf(r.Context())
	if !ok {
		// The mount is wrapped in the jwt+ensureOrg middleware, so an
		// unresolved org here means the caller's token carried no org claim —
		// every ae_* tool is org-scoped, so fail closed rather than act org-less.
		writeToolError(w, req.ID, "org not resolved from caller token")
		return
	}

	args := call.Arguments
	if args.Project == "" {
		writeToolError(w, req.ID, "missing required argument: project")
		return
	}
	slog.InfoContext(r.Context(), "sre-mcp tool call", "org", org, "tool", call.Name, "project", args.Project)

	switch call.Name {
	case "ae_search_related_issues":
		issues, err := h.issues.ListIssues(r.Context(), org, args.Project, args.Labels)
		if err != nil {
			writeToolError(w, req.ID, fmt.Sprintf("search related issues: %v", err))
			return
		}
		writeToolText(w, req.ID, mustJSON(gitrepo.RankIssuesByQuery(issues, args.Query)))
	case "ae_create_issue":
		issue, err := h.issues.CreateIssue(r.Context(), org, args.Project, gitrepo.CreateIssueRequest{
			Title:     args.Title,
			Body:      args.Body,
			Labels:    args.Labels,
			DedupeKey: args.DedupeKey,
		})
		if err != nil {
			writeToolError(w, req.ID, fmt.Sprintf("create issue: %v", err))
			return
		}
		writeToolText(w, req.ID, mustJSON(issue))
	case "ae_dispatch_coding_agent":
		if h.cmds == nil {
			writeToolError(w, req.ID, "task command surface not configured")
			return
		}
		// title/issueUrl are accepted for tool-contract stability but unused
		// server-side (the issue already carries them). PromoteAndExecute is
		// idempotent and dispatches through the funnel out-of-band (async).
		if err := h.cmds.PromoteAndExecute(r.Context(), org, args.Project, args.ComponentName, args.IssueNumber); err != nil {
			writeToolError(w, req.ID, fmt.Sprintf("dispatch coding agent: %v", dispatchErrText(err)))
			return
		}
		writeToolText(w, req.ID, mustJSON(map[string]any{"dispatched": true}))
	default:
		writeRPCError(w, req.ID, -32602, "unknown tool: "+call.Name)
	}
}

// dispatchErrText maps the task command surface's sentinel errors to stable,
// caller-facing text (the SRE agent's LLM reads it), leaving anything else as-is.
func dispatchErrText(err error) string {
	switch {
	case errors.Is(err, task.ErrComponentNameRequired):
		return "componentName is required"
	case errors.Is(err, task.ErrTaskNotFound):
		return "issue not found or is not an AE task"
	case errors.Is(err, task.ErrIssueClosed):
		return "issue is closed"
	case errors.Is(err, task.ErrProjectRepoNotFound):
		return "project repository not found"
	default:
		return err.Error()
	}
}

// ---- JSON-RPC / MCP write helpers (self-contained; the discovery server keeps
// its own copies so this merge does not touch dependencies/mcp_server.go) -----

func writeRPCResult(w http.ResponseWriter, id json.RawMessage, result any) {
	writeJSON(w, jsonrpcResponse{JSONRPC: "2.0", ID: id, Result: result})
}

func writeRPCError(w http.ResponseWriter, id json.RawMessage, code int, msg string) {
	writeJSON(w, jsonrpcResponse{JSONRPC: "2.0", ID: id, Error: &jsonrpcError{Code: code, Message: msg}})
}

// writeToolText returns a successful tools/call result with a single text block.
func writeToolText(w http.ResponseWriter, id json.RawMessage, text string) {
	writeRPCResult(w, id, map[string]any{
		"content": []map[string]any{{"type": "text", "text": text}},
	})
}

// writeToolError returns a tools/call result flagged isError (MCP tool-level error).
func writeToolError(w http.ResponseWriter, id json.RawMessage, text string) {
	writeRPCResult(w, id, map[string]any{
		"content": []map[string]any{{"type": "text", "text": text}},
		"isError": true,
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("sre-mcp: encode response", "error", err)
	}
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("{\"error\":%q}", err.Error())
	}
	return string(b)
}
