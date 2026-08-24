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

package ops

import (
	"context"
	"errors"
)

// Deps is what this domain must be handed to exist: typed ports, never concrete
// collaborators (§8). Constructor injection only — no setters, no framework.
//
// It lives in the domain ROOT, but the thing that CONSUMES it (the aggregator
// that builds the slice handlers) lives in httpapi/ — see httpapi/doc.go for why
// the domain's composition cannot sit here.
type Deps struct {
	// Reports is the persistence port. Required.
	Reports Repository
	// Execs correlates a report against live Task executions. Optional: nil
	// disables correlation and the stored snapshot is served as-is.
	Execs ExecutionReader
	// Escalator files the issue a handoff declined to file. Optional: nil
	// stores a declined report exactly as the handoff sent it, which is the
	// pre-escalation behaviour.
	Escalator IssueEscalator
}

// FiledIssue is what an escalation produced. Adopted false means the issue
// exists but nothing is working it — a project with no built version yet, say —
// which is why it is reported separately from the number.
type FiledIssue struct {
	Number        int64
	URL           string
	Adopted       bool
	AdoptionError string
}

// IssueEscalator files an issue and hands it to the coding agent. Satisfied by
// an app-root adapter over the sourcecontrol Adopter — the same one
// `ae_create_issue` reaches — so an escalated issue is indistinguishable from
// one the handoff filed itself.
//
// Declared here rather than in the slice that uses it because Deps carries it,
// and a narrow local port rather than the sourcecontrol type because ops serves
// the console's ops surface and has no business importing the issue stack.
type IssueEscalator interface {
	FileAndDispatch(
		ctx context.Context,
		orgID, projectID, componentName, title, body, dedupeKey string,
	) (FiledIssue, error)
}

// Validate reports a Deps that cannot produce a working domain. It exists
// because `var _ Iface = (*T)(nil)` proves a method SET and never the wiring: a
// nil Reports builds green and panics on the first request, which is exactly the
// failure the assembly test must catch at construction time instead.
func (d Deps) Validate() error {
	if d.Reports == nil {
		return errors.New("ops: Deps.Reports is required")
	}
	return nil
}
