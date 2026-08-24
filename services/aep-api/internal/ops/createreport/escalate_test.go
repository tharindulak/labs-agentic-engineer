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
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/ops"
)

// declinedDiagnosis is report c82f1fb8's shape: one high-confidence root cause,
// one config action the remediation agent already expressed as a ReleaseBinding
// change, and two code-level actions left unaddressed.
const declinedDiagnosis = `service1 timed out waiting for service2.

## Root causes
1. service2's processing time (~8s) exceeded service1's idle timeout (~5.8s). _(confidence: high)_
   service1 aborted the request after 5,403ms.

## Recommended actions
- Update ReleaseBinding ` + "`svc1-development`" + ` env var ` + "`IDLE_TIMEOUT`" + ` to at least 15s _(revised)_
  The workload has no explicit timeout env var set.
- Investigate and optimize service2's processing latency _(suggested)_
  An ~8s backend processing time is unusually slow.
- Implement retry logic with exponential back-off in service1 _(suggested)_
  A single slow request caused a visible ERROR and alert.

## Timeline
- ` + "`06:48:45Z`" + ` service1 received the request
`

func declinedReport() *ops.RcaAgentReport {
	return &ops.RcaAgentReport{
		Project:        "demo-developers-test-13",
		Component:      "demo-developers-test-13-service1",
		Title:          "service2's processing time exceeded service1's idle timeout",
		Summary:        "service1 timed out waiting for service2.",
		Classification: "none",
		Diagnosis:      declinedDiagnosis,
	}
}

func TestShouldEscalate_HighConfidenceDeclineWithCodeActions(t *testing.T) {
	t.Parallel()
	got := shouldEscalate(declinedReport())
	if !got.escalate {
		t.Fatalf("a high-confidence decline with unaddressed code-level actions must escalate; reason=%q", got.reason)
	}
	if len(got.actions) != 2 {
		t.Fatalf("want the 2 suggested actions, got %d: %v", len(got.actions), got.actions)
	}
	if !strings.Contains(got.actions[1], "retry logic") {
		t.Fatalf("second action should be the retry one, got %q", got.actions[1])
	}
}

func TestShouldEscalate_SkipsWhenAnIssueWasAlreadyFiled(t *testing.T) {
	t.Parallel()
	r := declinedReport()
	n := int64(5)
	r.IssueNumber = &n
	if shouldEscalate(r).escalate {
		t.Fatal("a report that already carries an issue must not be escalated again")
	}
}

func TestShouldEscalate_SkipsCodeLevelAndMixed(t *testing.T) {
	t.Parallel()
	for _, c := range []string{"code-level", "mixed"} {
		r := declinedReport()
		r.Classification = c
		if shouldEscalate(r).escalate {
			t.Fatalf("classification %q already means the handoff filed; must not escalate", c)
		}
	}
}

// Confidence is no longer a gate: any code the report suspects is handed over.
// A low-confidence root cause with a code-level action is still a code-level
// action nobody addressed, and an unfiled defect is dropped for good.
func TestShouldEscalate_EscalatesOnAnyCodeSuspicionRegardlessOfConfidence(t *testing.T) {
	t.Parallel()
	for _, confidence := range []string{"high", "medium", "low"} {
		r := declinedReport()
		r.Diagnosis = strings.ReplaceAll(r.Diagnosis, "confidence: high", "confidence: "+confidence)
		got := shouldEscalate(r)
		if !got.escalate {
			t.Fatalf("confidence %q: must still escalate; reason=%q", confidence, got.reason)
		}
	}
}

// No confidence annotation at all is the same case: the actions are what matter.
func TestShouldEscalate_EscalatesWithNoConfidenceAnnotation(t *testing.T) {
	t.Parallel()
	r := declinedReport()
	r.Diagnosis = strings.ReplaceAll(r.Diagnosis, " _(confidence: high)_", "")
	if got := shouldEscalate(r); !got.escalate {
		t.Fatalf("a missing confidence annotation must not block a code-level action; reason=%q", got.reason)
	}
}

// The whole point of the rule is "fixable in code". An action the remediation
// agent already expressed as a config change is not one.
func TestShouldEscalate_SkipsWhenEveryActionIsConfig(t *testing.T) {
	t.Parallel()
	r := declinedReport()
	r.Diagnosis = strings.ReplaceAll(r.Diagnosis, "_(suggested)_", "_(revised)_")
	got := shouldEscalate(r)
	if got.escalate {
		t.Fatalf("no code-level action means nothing to hand a coding agent; reason=%q", got.reason)
	}
}

func TestShouldEscalate_SkipsConfigLevelWithNoCodeActions(t *testing.T) {
	t.Parallel()
	r := declinedReport()
	r.Classification = "config-level"
	r.Diagnosis = strings.ReplaceAll(r.Diagnosis, "_(suggested)_", "_(revised)_")
	if shouldEscalate(r).escalate {
		t.Fatal("config-level with only config actions must not escalate")
	}
}

func TestEscalationIssue_CarriesActionsAndPreserveGuard(t *testing.T) {
	t.Parallel()
	r := declinedReport()
	dec := shouldEscalate(r)
	title, body := escalationIssue(r, dec.actions)

	if title == "" {
		t.Fatal("title is required")
	}
	if strings.Contains(title, "\n") {
		t.Fatalf("title must be one line, got %q", title)
	}
	for _, want := range []string{"retry logic", "optimize service2"} {
		if !strings.Contains(body, want) {
			t.Fatalf("body must carry the code-level action %q:\n%s", want, body)
		}
	}
	// An earlier escalated fix regressed four acceptance criteria by quietly
	// changing a default, so every escalated issue has to say not to.
	if !strings.Contains(body, "preserve every current default") {
		t.Fatalf("body must carry a preserve-the-defaults guard:\n%s", body)
	}
	if !strings.Contains(body, "IDLE_TIMEOUT") {
		t.Fatalf("body should note the config action as context:\n%s", body)
	}
	// The handoff's own reasoning belongs in the issue: whoever reads it needs
	// to know the agent argued against this.
	if !strings.Contains(body, "ruled this out") {
		t.Fatalf("body must record that the handoff declined:\n%s", body)
	}
}

// A spec conflict is no longer grounds to withhold the issue — it is stated in
// the issue and the coding agent decides. The handoff's own reasoning is quoted
// so whoever reads it knows an agent argued against this.
func TestEscalationIssue_StatesTheSpecConflictAndTheCriteriaCheck(t *testing.T) {
	t.Parallel()
	r := declinedReport()
	r.Diagnosis += "\n## Handoff decision\n\n**Classification:** none\n\n" +
		"Action 2 conflicts with AC-003-a, which fixes service2's delay at ~8s.\n"
	dec := shouldEscalate(r)
	_, body := escalationIssue(r, dec.actions)

	// The conflict is carried, not used to drop the issue.
	if !strings.Contains(body, "AC-003-a") {
		t.Fatalf("body must quote the handoff's spec reasoning:\n%s", body)
	}
	// Prose alone did not hold — an earlier fix moved a default anyway — so the
	// instruction has to name the file and demand a list.
	if !strings.Contains(body, "specs/validation/validation-criteria.json") {
		t.Fatalf("body must tell the agent which file to check:\n%s", body)
	}
	if !strings.Contains(body, "not planned") {
		t.Fatalf("body must say what to do when a criterion blocks the change:\n%s", body)
	}
}

// No handoff-decision section in the report: the issue still carries the check,
// just nothing to quote.
func TestEscalationIssue_CriteriaCheckSurvivesAMissingHandoffSection(t *testing.T) {
	t.Parallel()
	r := declinedReport()
	dec := shouldEscalate(r)
	_, body := escalationIssue(r, dec.actions)
	if !strings.Contains(body, "specs/validation/validation-criteria.json") {
		t.Fatalf("the criteria check is unconditional:\n%s", body)
	}
}

func TestEscalationDedupeKey_IsStablePerComponent(t *testing.T) {
	t.Parallel()
	a := escalationDedupeKey(declinedReport())
	b := escalationDedupeKey(declinedReport())
	if a != b || a == "" {
		t.Fatalf("dedupe key must be stable and non-empty, got %q and %q", a, b)
	}
	if !strings.Contains(a, "demo-developers-test-13-service1") {
		t.Fatalf("dedupe key should be scoped to the component, got %q", a)
	}
}
