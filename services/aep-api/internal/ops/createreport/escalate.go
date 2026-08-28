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
// The rule: ANY code the report suspects is handed over. A declined report that
// names at least one code-level action is filed and dispatched anyway.
//
// Confidence is deliberately NOT a gate. A low-confidence root cause with an
// unaddressed code-level action is still an unaddressed code-level action, and
// the costs are not symmetric: an unfiled defect is dropped for good, while an
// unnecessary issue is one the coding agent closes in minutes.
//
// Neither is a spec conflict a reason to withhold. "This change would break an
// acceptance criterion" is stated IN the issue rather than used to drop it,
// because the criterion may be the thing that is wrong — and a requirement
// nobody is shown is a requirement nobody can correct. The coding agent has the
// repository and the spec; it decides, and closing as not planned is a first
// class answer (ADR-0023).
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

// shouldEscalate applies the rule. Every gate is a reason a coding agent would
// have nothing to do, or would duplicate work already done.
func shouldEscalate(r *ops.RcaAgentReport) escalationDecision {
	if r == nil {
		return escalationDecision{reason: "no report"}
	}
	// The issue number is the ONLY evidence that an issue exists, and it is the
	// only thing checked. Classification is not evidence: a handoff can answer
	// needs_code_change=true and still end its turn without calling
	// ae_create_issue, leaving a `code-level` or `mixed` report with nothing
	// filed. That drop is the deceptive one — it looks like the system working —
	// and it has been observed on two projects.
	if r.IssueNumber != nil {
		return escalationDecision{reason: "an issue is already recorded on this report"}
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

	// Prose did not hold. An earlier escalated fix carried a "preserve every
	// default" paragraph and moved a timeout default from 5s to 10s regardless,
	// breaking four passing criteria. So this names the file and demands a list:
	// a step with an output is harder to skim past than an exhortation.
	b.WriteString("\n## Before you change a default\n\n")
	b.WriteString("Read `specs/validation/validation-criteria.json` and list the criteria your " +
		"change could affect. If any of them would fail, do NOT make the change — close this " +
		"issue as not planned, naming the criterion that blocks it.\n\n")
	// Deliberately generic: naming the KINDS of value to preserve would describe
	// whichever incident happened to motivate this section and mislead every
	// other one. The criteria file above supplies the specifics.
	b.WriteString("Otherwise this issue asks for the actions above and nothing else: preserve " +
		"every current default and every observable behaviour. If an action needs a value to " +
		"become configurable, keep the value it has today as the default.\n")

	if reasoning := handoffReasoning(r.Diagnosis); reasoning != "" {
		b.WriteString("\n## The handoff argued against this\n\n")
		b.WriteString(reasoning)
		b.WriteString("\n\nThat reasoning may be right — but a spec conflict is not grounds to " +
			"drop an incident, because the spec itself may be what is wrong. Judge it with the " +
			"repository in front of you and say which it is.\n")
	}

	if len(r.Diagnosis) > 0 {
		if _, config := splitActions(r.Diagnosis); len(config) > 0 {
			b.WriteString("\n## Already handled as configuration\n\n")
			for _, a := range config {
				fmt.Fprintf(&b, "- %s\n", a)
			}
			b.WriteString("\nDo not re-implement these in code.\n")
		}
	}

	fmt.Fprintf(&b, "\n---\n\nThe SRE handoff ruled this out (classification `%s`) while the actions "+
		"above were left unaddressed, so the platform filed it: any code an RCA suspects is "+
		"handed over, because an unfiled defect is dropped for good. Closing this as not "+
		"planned with your reasoning is a valid outcome.\n", r.Classification)

	return title, b.String()
}

// handoffReasoning returns the report's `## Handoff decision` prose, which is
// where the handoff explains a decline. Quoted into the issue so the coding
// agent inherits the argument against the work rather than rediscovering it.
//
// Capped because the section can run to several hundred words and the issue body
// has to stay readable; the full text is on the report either way.
func handoffReasoning(diagnosis string) string {
	const heading = "## Handoff decision"
	i := strings.Index(diagnosis, heading)
	if i < 0 {
		return ""
	}
	body := diagnosis[i+len(heading):]
	// Stop at the next same-level heading so a later section is not swallowed.
	if j := strings.Index(body, "\n## "); j >= 0 {
		body = body[:j]
	}
	body = strings.TrimSpace(body)
	const cap = 1500
	if len(body) > cap {
		body = strings.TrimSpace(body[:cap]) + "\n\n_(truncated — full reasoning is on the RCA report)_"
	}
	return body
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
