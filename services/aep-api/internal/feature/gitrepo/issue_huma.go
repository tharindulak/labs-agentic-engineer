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

package gitrepo

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"unicode"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/platform/humakit"
)

// --- Inputs / Outputs ------------------------------------------------------
// Mirrors task_huma.go's convention: inputs embed humakit.OrgScopedInput
// (tenant gate, no {orgHandle} path param), ProjectName is a sibling path
// param that IS the project's slug/ID throughout this codebase (see
// task.ListTasks / task.GetTasks, which pass ProjectName straight through
// as "projectID").

type createIssueInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
	Body        CreateIssueRequest
}

type listIssuesInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
	Labels      string `query:"labels" doc:"Comma-separated GitHub labels to filter by"`
	Query       string `query:"q" doc:"Keyword search over issue title/body, applied client-side after the GitHub label filter. The query is lowercased and tokenised (split on non-alphanumeric boundaries; stopwords and tokens shorter than 3 chars dropped), and issues are ranked by how many DISTINCT query terms they contain (title matches weighted double). Highest-scoring first, capped at 25; a non-overlapping query returns nothing, an empty/all-stopword query returns all. Optimised for recall — used to surface related issues before filing a new one."`
}

type issueOutput struct{ Body *IssueResult }
type issueListOutput struct{ Body []IssueInfo }

// RegisterIssue registers issue create/search operations on the Huma API.
// These back external handoffs — e.g. the OpenChoreo SRE/RCA agent files an
// issue here (and searches for related ones first) ahead of dispatching the
// coding agent via task.RegisterTask's dispatch-task-from-issue operation.
// See AE-HANDOFF-DESIGN.md (openchoreo/agents/sre-agent) for the end-to-end
// flow this supports.
func RegisterIssue(api huma.API, svc IssueService) {
	huma.Register(api, huma.Operation{
		OperationID: "create-issue",
		Method:      http.MethodPost,
		Path:        "/projects/{projectName}/issues",
		Summary:     "Create a GitHub issue on a project's repo",
		Tags:        []string{"Issues"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *createIssueInput) (*issueOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("issue service not configured")
		}
		issue, err := svc.CreateIssue(ctx, in.OrgHandle, in.ProjectName, in.Body)
		if err != nil {
			if errors.Is(err, ErrRepoNotFound) {
				return nil, huma.Error404NotFound("project repo not found")
			}
			return nil, huma.Error500InternalServerError("failed to create issue")
		}
		return &issueOutput{Body: issue}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "list-issues",
		Method:      http.MethodGet,
		Path:        "/projects/{projectName}/issues",
		Summary:     "List/search GitHub issues on a project's repo",
		Tags:        []string{"Issues"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *listIssuesInput) (*issueListOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("issue service not configured")
		}
		var labels []string
		if strings.TrimSpace(in.Labels) != "" {
			for _, l := range strings.Split(in.Labels, ",") {
				if l = strings.TrimSpace(l); l != "" {
					labels = append(labels, l)
				}
			}
		}
		issues, err := svc.ListIssues(ctx, in.OrgHandle, in.ProjectName, labels)
		if err != nil {
			if errors.Is(err, ErrRepoNotFound) {
				return nil, huma.Error404NotFound("project repo not found")
			}
			return nil, huma.Error500InternalServerError("failed to list issues")
		}

		return &issueListOutput{Body: RankIssuesByQuery(issues, in.Query)}, nil
	})
}

// maxRankedIssues caps how many candidates we hand back for a keyword search,
// so a large repo can't flood the caller (the SRE/RCA handoff agent, which
// then judges semantic relatedness itself). Highest-scoring first.
const maxRankedIssues = 25

// issueSearchStopwords are dropped from the query so generic words don't
// match everything. Deliberately small — domain terms (timeout, service1,
// oomkilled, …) must survive.
var issueSearchStopwords = map[string]bool{
	"the": true, "and": true, "for": true, "with": true, "add": true,
	"fix": true, "when": true, "from": true, "this": true, "that": true,
	"into": true, "via": true, "issue": true, "error": true, "errors": true,
}

// RankIssuesByQuery replaces the old single-substring filter, which returned
// nothing whenever the caller passed a multi-word query (the exact miss that
// left same-incident issues unlinked): "service1 timeout retry" was never a
// literal substring of any issue. Now the query is tokenised and each issue
// is scored by how many DISTINCT query terms it contains (title matches count
// double), so a natural-language query still surfaces lexically-overlapping
// candidates. Precision is intentionally left to the LLM handoff agent, which
// reads the returned title/body and judges true semantic relatedness — this
// layer only has to get real candidates in front of it (recall), not decide.
//
// Empty/all-stopword query → return everything (unchanged contract for a
// "list all" call). No overlap → empty, same as before.
func RankIssuesByQuery(issues []IssueInfo, query string) []IssueInfo {
	terms := tokenizeIssueQuery(query)
	if len(terms) == 0 {
		return issues
	}
	type scored struct {
		iss   IssueInfo
		score int
	}
	ranked := make([]scored, 0, len(issues))
	for _, iss := range issues {
		title := strings.ToLower(iss.Title)
		body := strings.ToLower(iss.Body)
		score := 0
		for t := range terms {
			if strings.Contains(title, t) {
				score += 2
			} else if strings.Contains(body, t) {
				score++
			}
		}
		if score > 0 {
			ranked = append(ranked, scored{iss, score})
		}
	}
	// Stable sort by score desc so equal-scoring issues keep GitHub's order
	// (newest first) — makes the output deterministic for tests and callers.
	sort.SliceStable(ranked, func(i, j int) bool { return ranked[i].score > ranked[j].score })
	if len(ranked) > maxRankedIssues {
		ranked = ranked[:maxRankedIssues]
	}
	out := make([]IssueInfo, len(ranked))
	for i, r := range ranked {
		out[i] = r.iss
	}
	return out
}

// tokenizeIssueQuery lowercases the query, splits on non-alphanumeric
// boundaries, and drops stopwords and tokens shorter than 3 chars. Returns a
// set so a repeated word doesn't inflate an issue's score.
func tokenizeIssueQuery(query string) map[string]bool {
	terms := make(map[string]bool)
	for _, tok := range strings.FieldsFunc(strings.ToLower(query), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		if len(tok) < 3 || issueSearchStopwords[tok] {
			continue
		}
		terms[tok] = true
	}
	return terms
}
