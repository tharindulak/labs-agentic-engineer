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
	"fmt"
	"regexp"
	"strings"

	"github.com/wso2/aep/aep-api/internal/ops"
)

// Escalation: filing the issue the handoff should have filed.
//
// The SRE handoff decides whether an RCA root cause needs a code change, and a
// decline used to end the incident — the report is written, no issue exists, and
// nothing surfaces it again. Two live cases (reports 59796491 and c82f1fb8) were
// declined on a high-confidence root cause that still carried code-level actions
// nobody addressed.
//
// Guidance did not hold. The `issue-fix` skill already names that exact scenario
// as the likeliest way to get the decision wrong, and c82f1fb8 was declined by an
// agent running the updated skill. So the rule is enforced HERE instead: this is
// the one place AEP sees every report, on a path the handoff cannot skip, which
// makes it the only place the outcome can be guaranteed rather than requested.
//
// The rule: a high-confidence root cause that names at least one code-level
// action, declined without an issue, is filed and dispatched anyway.
//
// Reading the decision out of markdown is a known compromise. `diagnosis` is one
// free-text blob, so confidence and action status are recovered by pattern rather
// than read from fields. It is kept deliberately narrow — two anchored patterns,
// no semantic parsing — and the durable fix is for the SRE agent to send both as
// structured fields, which is a contract change on its side.

// suggestedStatus marks an action the remediation agent could NOT express as an
// OpenChoreo ReleaseBinding change. Per the skill that is "a strong signal ...
// it is not a config problem", which is what makes it the code-level marker.
const suggestedStatus = "_(suggested)_"

// revisedStatus marks an action already actionable as configuration. Present
// only so the escalated issue can mention it as context — never as work.
const revisedStatus = "_(revised)_"

var (
	// highConfidence matches the root-cause confidence annotation, e.g.
	// "_(confidence: high)_". Anchored on the label so a stray "high" in prose
	// cannot trip it.
	highConfidence = regexp.MustCompile(`(?i)confidence:\s*high`)
	// actionBullet captures one recommended-action bullet and its status
	// annotation. Rationale lines are indented and so never match.
	actionBullet = regexp.MustCompile(`(?m)^-\s+(.*?)\s*(_\((?:suggested|revised)\)_)\s*$`)
)

// escalationDecision is why a report was or was not escalated. The reason is
// carried for the log line: "did not escalate" is the answer somebody will ask
// about, and recomputing it from the report later is guesswork.
type escalationDecision struct {
	escalate bool
	reason   string
	// actions are the code-level actions the issue must hand over.
	actions []string
	// configActions go into the body as context, so the coding agent does not
	// redo in code what the remediation agent already did in configuration.
	configActions []string
}

// declinedClassifications are the two classifications that mean "no issue was
// filed". code-level and mixed both mean the handoff filed one itself.
var declinedClassifications = map[string]bool{
	"none":         true,
	"config-level": true,
}

// shouldEscalate applies the rule. Every gate is a reason a coding agent would
// have nothing to do, or would duplicate work already done.
func shouldEscalate(r *ops.RcaAgentReport) escalationDecision {
	if r == nil {
		return escalationDecision{reason: "no report"}
	}
	// An issue already exists: the handoff filed, or a previous escalation did.
	// Re-filing pays for a second coding cycle on one incident.
	if r.IssueNumber != nil {
		return escalationDecision{reason: "an issue is already recorded on this report"}
	}
	if !declinedClassifications[r.Classification] {
		return escalationDecision{reason: fmt.Sprintf("classification %q means the handoff filed its own issue", r.Classification)}
	}
	if !highConfidence.MatchString(r.Diagnosis) {
		return escalationDecision{reason: "no root cause is annotated confidence: high"}
	}
	code, config := splitActions(r.Diagnosis)
	if len(code) == 0 {
		return escalationDecision{
			reason:        "no code-level action remains — nothing to hand a coding agent",
			configActions: config,
		}
	}
	return escalationDecision{escalate: true, actions: code, configActions: config}
}

// splitActions returns the recommended actions by status: code-level (suggested)
// and config (revised). Order is preserved so the issue reads like the report.
func splitActions(diagnosis string) (code, config []string) {
	for _, m := range actionBullet.FindAllStringSubmatch(diagnosis, -1) {
		text := strings.TrimSpace(m[1])
		if text == "" {
			continue
		}
		switch m[2] {
		case suggestedStatus:
			code = append(code, text)
		case revisedStatus:
			config = append(config, text)
		}
	}
	return code, config
}

// escalationIssue builds the issue the coding agent will work.
//
// The body says three things beyond the actions, and each is there because its
// absence has already cost something:
//
//   - What must not change. Test-11's escalated fix made a timeout configurable
//     AND quietly moved its default from 5s to 10s, which broke four acceptance
//     criteria that were passing. Configurability is the ask; changed behaviour
//     is not.
//   - The handoff's own decline. Whoever reads this needs to know an agent
//     argued against it, so a wrong escalation is closed in seconds rather than
//     investigated.
//   - The config action as context, so the fix does not re-implement in code
//     what the remediation agent already changed in configuration.
func escalationIssue(r *ops.RcaAgentReport, actions []string) (title, body string) {
	component := r.Component
	if component == "" {
		component = r.Project
	}
	title = fmt.Sprintf("Address the code-level actions from the RCA on %s", component)

	var b strings.Builder
	fmt.Fprintf(&b, "## RCA summary\n\n%s\n\n", strings.TrimSpace(r.Summary))
	b.WriteString("## Code-level actions\n\n")
	for _, a := range actions {
		fmt.Fprintf(&b, "- %s\n", a)
	}
	if len(r.Title) > 0 {
		fmt.Fprintf(&b, "\n## Root cause\n\n%s\n", strings.TrimSpace(r.Title))
	}

	b.WriteString("\n## What must not change\n\n")
	b.WriteString("This issue asks for the actions above and nothing else. The version's " +
		"acceptance criteria are passing — preserve every current default, status code, " +
		"timing threshold and log line exactly as they are. If an action needs a value to " +
		"become configurable, keep the value it has today as the default. A change that " +
		"makes a passing criterion fail is a worse outcome than not fixing this at all.\n")

	if len(r.Diagnosis) > 0 {
		if _, config := splitActions(r.Diagnosis); len(config) > 0 {
			b.WriteString("\n## Already handled as configuration\n\n")
			for _, a := range config {
				fmt.Fprintf(&b, "- %s\n", a)
			}
			b.WriteString("\nDo not re-implement these in code.\n")
		}
	}

	fmt.Fprintf(&b, "\n---\n\nThe SRE handoff ruled this out (classification `%s`) while the root cause "+
		"was annotated confidence: high and the actions above were left unaddressed, so the "+
		"platform filed it. Its reasoning is in the RCA report's `## Handoff decision` "+
		"section — read it before starting, and close this issue if the decline was right.\n",
		r.Classification)

	return title, b.String()
}

// escalationDedupeKey scopes escalations to one per component, so a recurring
// alert folds onto the open issue instead of filing a new one each time. Shares
// the `sre-rca/` namespace the handoff's own keys use.
func escalationDedupeKey(r *ops.RcaAgentReport) string {
	scope := r.Component
	if scope == "" {
		scope = r.Project
	}
	return "sre-rca-escalated/" + scope
}
