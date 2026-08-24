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

package sourcecontrol

import (
	"fmt"
	"regexp"
	"strings"
)

// Recurrence: the same incident happening again after the platform believed it
// had fixed it. See ADR-0021 — a merged fix is not a resolved incident.
//
// The decisions this file encodes, all of them deliberate:
//
//   - It is recognised DETERMINISTICALLY, from the dedupe fingerprint plus facts
//     GitHub already owns, never from a judgment. No model is asked.
//   - There is NO time bound. An incident that resurfaces a year later is still
//     that incident, and the thread recording what was already tried serves the
//     next coding agent better than a blank new issue.
//   - A human's `not_planned` close is never a recurrence. The platform does not
//     overrule somebody who decided against the work.
//   - The escalation threshold is a claim about ATTENTION, not permission.
//     Nothing here ever refuses an attempt.
const (
	// LabelSREAgent marks every issue the SRE/RCA handoff filed. It is stamped
	// by the handoff in code (not by its prompt), which is what makes it safe to
	// read as "this issue is an incident, not ordinary work".
	//
	// It lives here rather than in delivery's label vocabulary because that
	// vocabulary is the milestone model's — agent work, gates, validation — and
	// this label says nothing about how an issue is worked, only where it came
	// from. It is read in exactly one place: the recurrence predicate.
	LabelSREAgent = "sre-agent"

	// stateReasonCompleted / stateReasonNotPlanned are GitHub's own vocabulary
	// for WHY a closed issue is closed. Only the first can recur.
	stateReasonCompleted  = "completed"
	stateReasonNotPlanned = "not_planned"

	// recurrenceEscalation is the attempt from which a recurrence is reported
	// loudly. Attempt 1 is the original filing, so this fires once three
	// attempts have already failed. It changes what the platform SAYS and
	// nothing about what it does.
	recurrenceEscalation = 4
)

// recurrenceHeadingRE matches the section heading this file writes. The count of
// these headings in a body is how many times the incident has already come
// back, which makes the body the record of the attempt number.
//
// This is the one place the platform reads structure out of an issue body, and
// it is a deliberate, bounded exception to `delivery/labels.go`'s rule that
// bodies are prose: the platform both writes and reads this section, and no
// other decision depends on it. A label is the fallback the moment a second one
// does (ADR-0021).
var recurrenceHeadingRE = regexp.MustCompile(`(?m)^##[ \t]+Recurrence[ \t]+\d+[ \t]*$`)

// attemptNumber reports which attempt an issue is on: 1 before any recurrence,
// 2 on the first one, and so on. It is derived from the body rather than stored
// so that GitHub stays the sole owner of Task state.
func attemptNumber(body string) int {
	return len(recurrenceHeadingRE.FindAllString(body, -1)) + 1
}

// isRecurrenceOf reports whether a closed issue found by dedupe key is the same
// incident recurring, and may therefore be reopened rather than re-filed.
//
// All three conditions earn their place: `closed` because an open issue is
// handled by ordinary dedupe and its own run owns it; `completed` because the
// platform must not overrule a human's `not_planned`; and the SRE-agent label
// because only the incident path files issues whose recurrence means anything —
// a dedupe key on ordinary work must not resurrect a finished task.
//
// An empty StateReason is treated as NOT completed. GitHub omits the field on
// issues closed before it existed, and reopening on the strength of a field
// that is merely absent would guess in the one direction that overrules a human.
func isRecurrenceOf(iss IssueInfo) bool {
	if !hasLabelFold(iss.Labels, LabelSREAgent) {
		return false
	}
	if strings.EqualFold(iss.State, "closed") {
		// A human's `not_planned` close is never overruled, and an empty reason
		// (GitHub omits it on issues closed before the field existed) is not
		// read as completed — guessing there would guess in the one direction
		// that overrules a person.
		return strings.EqualFold(iss.StateReason, stateReasonCompleted)
	}
	// OPEN, and the third state this predicate has to know about: an unverified
	// fix (ADR-0022).
	return IsUnverifiedFix(iss)
}

// IsUnverifiedFix reports the state a merged-but-unvouched-for incident fix is
// left in: its pull request merged, GitHub closed the issue on the closing
// keyword, and the platform reopened it and took `aep` off — so it is open, on
// the version's record, and worked by nobody.
//
// The signature is three labels, and the ADOPTION one is what makes it precise.
// "Open and not agent work" on its own describes almost every ordinary issue in
// a repository, and reading that as a recurrence broke dedupe outright: two
// concurrent alert handlers stopped folding onto one issue, which is the exact
// duplicate-filing this key exists to prevent. `aep:codingagent` records the ACT
// of adoption and is never removed, so an issue carrying it WITHOUT `aep` is one
// the platform adopted and then deliberately stood down — which only this path
// does.
func IsUnverifiedFix(iss IssueInfo) bool {
	return hasLabelFold(iss.Labels, LabelSREAgent) &&
		hasLabelFold(iss.Labels, LabelAdopt) &&
		!hasLabelFold(iss.Labels, LabelAgentWork)
}

// LabelAgentWork and LabelAdopt mirror delivery's label vocabulary. They are
// duplicated rather than imported because delivery already depends on this
// package; this file needs only to recognise them, never to decide what the
// milestone model does with them.
const (
	LabelAgentWork = "aep"
	LabelAdopt     = "aep:codingagent"
)

func hasLabelFold(labels []string, want string) bool {
	for _, l := range labels {
		if strings.EqualFold(strings.TrimSpace(l), want) {
			return true
		}
	}
	return false
}

// IsNoChangeVerdict reports that a coding agent examined this issue and closed
// it as needing no code change — GitHub's `not_planned`, which means exactly
// "somebody decided against doing this work".
//
// It is the durable half of that verdict. Without it the next identical alert
// files a fresh issue and pays another full coding cycle to be told the same
// thing, which is what a fixture whose specified behaviour trips its own alert
// does on every request, forever.
//
// It deliberately does not distinguish an agent's `not_planned` from a human's.
// Both are a decision by someone who looked, and the platform overrules neither
// (ADR-0023).
func IsNoChangeVerdict(iss IssueInfo) bool {
	return strings.EqualFold(iss.State, "closed") &&
		strings.EqualFold(iss.StateReason, stateReasonNotPlanned) &&
		hasLabelFold(iss.Labels, LabelSREAgent)
}

// appendRecurrenceSection returns the issue body with a `## Recurrence <n>`
// section added, carrying the new evidence.
//
// The prose is the platform's, not an agent's, and that is the point. The
// coding agent's confidence declaration is what gates the merge of an incident
// fix, and a recurrence does NOT override that declaration — so the agent has to
// learn from somewhere that an earlier fix for this very issue already reached
// production and failed. Putting that sentence in the document the agent is
// guaranteed to read in full is what makes it un-loseable: no skill can drift
// away from it, and no comment can be skipped past.
func appendRecurrenceSection(body string, attempt int, findings string) string {
	var b strings.Builder
	b.WriteString(strings.TrimRight(body, "\n"))
	b.WriteString(fmt.Sprintf("\n\n## Recurrence %d\n\n", attempt))
	b.WriteString("**The previously merged fix did not resolve this.** ")
	b.WriteString("This issue was closed by a merged pull request, and the same failure ")
	b.WriteString("signature has been observed again in the deployed system.\n\n")
	b.WriteString("Before changing anything, find the pull request that closed this issue ")
	b.WriteString("and read what it already tried; repeating it will not work. Your ")
	b.WriteString("confidence declaration must reflect that an earlier fix here has ")
	b.WriteString("already failed.\n")
	if attempt >= recurrenceEscalation {
		b.WriteString(fmt.Sprintf(
			"\n> **Escalated** — this is attempt %d. The platform has not resolved this "+
				"incident across %d earlier attempts and is continuing to work it. "+
				"It is worth a human deciding whether this is a code fault at all.\n",
			attempt, attempt-1))
	}
	if f := strings.TrimSpace(findings); f != "" {
		b.WriteString("\n### New evidence\n\n")
		b.WriteString(f)
		b.WriteString("\n")
	}
	return b.String()
}
