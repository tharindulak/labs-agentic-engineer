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

// mcpTool is the MCP tools/list descriptor.
type mcpTool struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	InputSchema any    `json:"inputSchema"`
}

// handoffTools returns the ae_* tool descriptors advertised by tools/list. The
// names, descriptions, and input schemas are ported verbatim from the retired
// services/aep-mcp-server/src/server.ts so the SRE agent's tool contract is
// unchanged by the merge.
func handoffTools() []mcpTool {
	return []mcpTool{
		{
			Name: "ae_search_related_issues",
			Description: "Search existing GitHub issues on a project's repo to find related/duplicate issues " +
				"before filing a new one. Keyword-ranked: pass space-separated keywords (component name + " +
				"symptom terms), not a sentence; results come back ranked by keyword overlap for you to judge.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"project": map[string]any{"type": "string", "description": "OpenChoreo/AE project name"},
					"query": map[string]any{
						"type": "string",
						"description": "Space-separated keywords (e.g. 'service1 service2 timeout'), NOT a natural-language " +
							"phrase. Tokenised and matched against issue title/body; issues are returned ranked by how many " +
							"keywords they contain. Omit to list all issues.",
					},
					"labels": map[string]any{
						"type":        "array",
						"items":       map[string]any{"type": "string"},
						"description": "Filter by GitHub labels",
					},
				},
				"required": []string{"project"},
			},
		},
		{
			Name: "ae_create_issue",
			Description: "Create a GitHub issue on a project's repo. Use this for a code-level fix that needs the AE " +
				"coding agent — not for config-level changes. Pass a stable dedupeKey so concurrent callers reporting " +
				"the same incident share one issue: if an OPEN issue with the same key exists, it is returned with " +
				"`deduped: true` and no new issue is created.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"project": map[string]any{"type": "string", "description": "OpenChoreo/AE project name"},
					"title":   map[string]any{"type": "string", "description": "Issue title"},
					"body":    map[string]any{"type": "string", "description": "Issue body (markdown)"},
					"labels": map[string]any{
						"type":        "array",
						"items":       map[string]any{"type": "string"},
						"description": "GitHub labels to apply",
					},
					"dedupeKey": map[string]any{
						"type": "string",
						"description": "Stable idempotency key (e.g. 'sre-rca/<component>'). While an issue created with this " +
							"key is open, further creates with the same key return that issue (deduped: true) instead of filing " +
							"a duplicate.",
					},
				},
				"required": []string{"project", "title", "body"},
			},
		},
		{
			Name: "ae_dispatch_coding_agent",
			Description: "Create a task bound to an already-created GitHub issue and dispatch the AE coding agent " +
				"against it. Call ae_create_issue first and pass its returned issue number/url here. Dispatch is " +
				"async — this call only confirms the dispatch was accepted, not that the coding agent run has started " +
				"or finished.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"project":       map[string]any{"type": "string", "description": "OpenChoreo/AE project name"},
					"componentName": map[string]any{"type": "string", "description": "Component this issue is about (the alerting component's name)"},
					"title":         map[string]any{"type": "string", "description": "Task title — reuse the issue title"},
					"issueNumber":   map[string]any{"type": "integer", "description": "GitHub issue number returned by ae_create_issue"},
					"issueUrl":      map[string]any{"type": "string", "description": "GitHub issue URL returned by ae_create_issue"},
				},
				"required": []string{"project", "componentName", "title", "issueNumber", "issueUrl"},
			},
		},
	}
}
