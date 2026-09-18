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
	"strings"
	"testing"
)

// The recurrence predicate is the whole safety story of reopening: it decides
// when the platform is allowed to reopen something a human may have closed on
// purpose. Every case here is one promise the predicate makes.
func TestIsRecurrenceOf(t *testing.T) {
	sre := []string{LabelSREAgent, "aep"}
	cases := []struct {
		name string
		iss  IssueInfo
		want bool
	}{
		{"closed as completed incident work recurs", IssueInfo{
			State: "closed", StateReason: stateReasonCompleted, Labels: sre}, true},
		{"GitHub's casing is not load-bearing", IssueInfo{
			State: "Closed", StateReason: "Completed", Labels: []string{"SRE-Agent"}}, true},
		// The promise that matters most: a human said "not planned", and no
		// number of recurrences lets the platform overrule that.
		{"a human's not_planned close is never reopened", IssueInfo{
			State: "closed", StateReason: stateReasonNotPlanned, Labels: sre}, false},
		// GitHub omits state_reason on issues closed before the field existed.
		// Absent must not be read as completed: guessing would guess in the one
		// direction that overrules a human.
		{"an absent state_reason is not completed", IssueInfo{
			State: "closed", Labels: sre}, false},
		// A dedupe key on ordinary work must never resurrect a finished task.
		{"non-incident work never recurs", IssueInfo{
			State: "closed", StateReason: stateReasonCompleted, Labels: []string{"aep"}}, false},
		// An OPEN issue is ordinary dedupe's business, and its own run owns it.
		{"an open issue is not a recurrence", IssueInfo{
			State: "open", Labels: sre}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := isRecurrenceOf(c.iss); got != c.want {
				t.Fatalf("isRecurrenceOf = %v, want %v", got, c.want)
			}
		})
	}
}

// attemptNumber is where the platform's ONE body-parsed decision lives, so it
// has to survive the bodies real issues actually carry.
func TestAttemptNumber(t *testing.T) {
	cases := []struct {
		name string
		body string
		want int
	}{
		{"a fresh issue is attempt 1", "## Scope\n\nsomething broke\n", 1},
		{"one recurrence makes it attempt 2", "body\n\n## Recurrence 2\n\nagain\n", 2},
		{"two recurrences", "b\n\n## Recurrence 2\n\nx\n\n## Recurrence 3\n\ny\n", 3},
		{"an empty body is attempt 1", "", 1},
		// Prose that merely mentions the word must not inflate the count — the
		// heading is the record, not the vocabulary.
		{"a mention in prose is not a section", "this is a recurrence of #4\n", 1},
		{"a deeper heading is not this section", "### Recurrence 2\n", 1},
		{"an unnumbered heading is not this section", "## Recurrence\n", 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := attemptNumber(c.body); got != c.want {
				t.Fatalf("attemptNumber = %d, want %d", got, c.want)
			}
		})
	}
}

// The round trip is the invariant that keeps the count honest across an
// unbounded number of recurrences: what the appender writes, the counter reads.
func TestAppendRecurrenceSectionRoundTrips(t *testing.T) {
	body := "## Scope\n\nthe original incident\n"
	for want := 2; want <= 6; want++ {
		if got := attemptNumber(body); got != want-1 {
			t.Fatalf("before attempt %d: attemptNumber = %d, want %d", want, got, want-1)
		}
		body = appendRecurrenceSection(body, want, "new evidence")
		if got := attemptNumber(body); got != want {
			t.Fatalf("after appending attempt %d: attemptNumber = %d", want, got)
		}
	}
	if !strings.Contains(body, "## Scope") {
		t.Error("appending must never destroy the original body")
	}
}

// The appended prose is not decoration. The confidence declaration decides
// whether an incident fix auto-merges, and a recurrence deliberately does NOT
// override that declaration — so this section is the only thing telling the
// agent an earlier fix already failed. If it stops saying so, the loop quietly
// loses its ability to learn (ADR-0032).
func TestAppendRecurrenceSectionTellsTheAgentTheLastFixFailed(t *testing.T) {
	got := appendRecurrenceSection("original", 2, "the same stack trace")
	for _, want := range []string{
		"## Recurrence 2",
		"previously merged fix did not resolve this",
		"confidence declaration",
		"the same stack trace",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("the recurrence section must carry %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "Escalated") {
		t.Error("attempt 2 is not escalated")
	}
}

// Escalation is a claim about ATTENTION, not permission: it changes what the
// platform says and nothing about what it does.
func TestAppendRecurrenceSectionEscalates(t *testing.T) {
	quiet := appendRecurrenceSection("b", recurrenceEscalation-1, "")
	if strings.Contains(quiet, "Escalated") {
		t.Errorf("attempt %d must not escalate yet", recurrenceEscalation-1)
	}
	loud := appendRecurrenceSection("b", recurrenceEscalation, "")
	if !strings.Contains(loud, "Escalated") {
		t.Errorf("attempt %d must escalate:\n%s", recurrenceEscalation, loud)
	}
	if !strings.Contains(loud, "worth a human deciding") {
		t.Error("escalation must say what it wants from a human")
	}
}

// A recurrence with nothing new to say still reopens; it just has no evidence
// section. Writing an empty heading would be worse than writing none.
func TestAppendRecurrenceSectionOmitsEmptyEvidence(t *testing.T) {
	if strings.Contains(appendRecurrenceSection("b", 2, "   "), "### New evidence") {
		t.Error("blank findings must not produce an empty evidence section")
	}
}

// AttentionReasonFor is the one thing ListIssues exposes to the console, so
// it has to agree with the predicates it composes rather than re-deriving
// them.
func TestAttentionReasonFor(t *testing.T) {
	sre := []string{LabelSREAgent}
	sreWorking := []string{LabelSREAgent, LabelAgentWork}
	cases := []struct {
		name string
		iss  IssueInfo
		want string
	}{
		{"an ordinary open issue has no attention reason", IssueInfo{
			State: "open", Labels: sreWorking, Body: "body"}, ""},
		{"a merged fix without confidence is unverified", IssueInfo{
			State: "open", StateReason: stateReasonReopened, Labels: sre, Body: "body"}, AttentionUnverifiedFix},
		{"reopened but still armed is not unverified", IssueInfo{
			State: "open", StateReason: stateReasonReopened, Labels: sreWorking, Body: "body"}, ""},
		{"a reopened issue with no sre-agent label is not unverified", IssueInfo{
			State: "open", StateReason: stateReasonReopened, Labels: nil, Body: "body"}, ""},
		{"not_planned is a no-change verdict", IssueInfo{
			State: "closed", StateReason: stateReasonNotPlanned, Labels: sre,
			Body: "body"}, AttentionNoChangeVerdict},
		{"completed close has no attention reason", IssueInfo{
			State: "closed", StateReason: stateReasonCompleted, Labels: sre,
			Body: "body"}, ""},
		{"attempt 4 is escalated", IssueInfo{
			State: "open", Labels: sreWorking,
			Body: "b\n\n## Recurrence 2\n\nx\n\n## Recurrence 3\n\ny\n\n## Recurrence 4\n\nz\n",
		}, AttentionEscalated},
		{"attempt 3 is not yet escalated", IssueInfo{
			State: "open", Labels: sreWorking,
			Body: "b\n\n## Recurrence 2\n\nx\n\n## Recurrence 3\n\ny\n",
		}, ""},
		{"a no-change verdict wins over an escalated attempt count", IssueInfo{
			State: "closed", StateReason: stateReasonNotPlanned, Labels: sre,
			Body: "b\n\n## Recurrence 2\n\nx\n\n## Recurrence 3\n\ny\n\n## Recurrence 4\n\nz\n",
		}, AttentionNoChangeVerdict},
		{"non-incident work never gets an attention reason", IssueInfo{
			State: "open", StateReason: stateReasonReopened, Labels: []string{LabelAgentWork}, Body: "body"}, ""},
		// IsUnverifiedFix and the escalation count are only meaningful for an
		// issue the platform is still actively working — isRecurrenceOf only
		// ever calls IsUnverifiedFix from its already-open branch, and never
		// treats a closed issue as a live escalation. AttentionReasonFor must
		// gate both the same way, or a closed issue that happens to carry a
		// stale label combination (should not occur in practice, since the
		// success path never removes `aep`) or a high recurrence count from
		// before it was finally fixed would be wrongly flagged after the fact.
		{"an unverified-fix signal on a closed+completed issue is not flagged", IssueInfo{
			State: "closed", StateReason: stateReasonCompleted, Labels: sre, Body: "body"}, ""},
		{"an escalated recurrence count is not flagged once completed and closed", IssueInfo{
			State: "closed", StateReason: stateReasonCompleted, Labels: sreWorking,
			Body: "b\n\n## Recurrence 2\n\nx\n\n## Recurrence 3\n\ny\n\n## Recurrence 4\n\nz\n",
		}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := AttentionReasonFor(c.iss); got != c.want {
				t.Fatalf("AttentionReasonFor = %q, want %q", got, c.want)
			}
		})
	}
}
