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

// The one property that matters for the native shape: a report derives the SAME
// row here that the SRE agent's own mapping used to send.
//
// The testdata is not hand-written. Each `*.expected.json` was produced by
// running the real Python (aep_reports.build_create_report_request) over the
// paired `*.report.json`, so this asserts cross-language equivalence against the
// implementation being replaced rather than against a second guess at it. If the
// agent's format ever legitimately changes, regenerate the pairs — do not edit
// them to match the Go.
//
// Byte-identical Markdown still matters, though less than it did: `diagnosis` is
// what the console renders, and the escalated issue quotes the handoff's own
// reasoning out of it (escalate.go's handoffReasoning). The escalation DECISION
// no longer reads it — that now comes from the report's action fields — so a
// rendering slip degrades a page rather than silently stopping escalation.
package createreport

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// pythonPayload is the wire body the agent used to build. Only the fields the
// mapping actually set are listed; a field absent from the JSON was one the
// Python deliberately omitted, and that omission is part of what is asserted.
type pythonPayload struct {
	Project        string `json:"project"`
	Component      string `json:"component"`
	Title          string `json:"title"`
	Summary        string `json:"summary"`
	Classification string `json:"classification"`
	Diagnosis      string `json:"diagnosis"`
	IssueNumber    *int64 `json:"issueNumber"`
	IssueURL       string `json:"issueUrl"`
	IssueExcerpt   string `json:"issueExcerpt"`
	Dispatched     bool   `json:"dispatched"`
	Recurrence     int    `json:"recurrence"`
}

func loadGolden(t *testing.T, name string) (map[string]any, pythonPayload) {
	t.Helper()

	raw, err := os.ReadFile(filepath.Join("testdata", name+".report.json"))
	if err != nil {
		t.Fatalf("read report: %v", err)
	}
	var report map[string]any
	if err := json.Unmarshal(raw, &report); err != nil {
		t.Fatalf("decode report: %v", err)
	}

	raw, err = os.ReadFile(filepath.Join("testdata", name+".expected.json"))
	if err != nil {
		t.Fatalf("read expected: %v", err)
	}
	var want pythonPayload
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatalf("decode expected: %v", err)
	}
	return report, want
}

// The three shapes that between them cover every branch of the renderer: a
// DECLINE (no issue, ruled-out actions, related issues — the case whose
// reasoning used to be dropped entirely), a FILED report carrying a recurrence,
// and a report with no root cause at all.
func TestFromNative_DerivesTheSameRowThePythonSent(t *testing.T) {
	for _, name := range []string{"declined", "filed", "minimal"} {
		t.Run(name, func(t *testing.T) {
			report, want := loadGolden(t, name)

			got, err := fromNative("org1", report)
			if err != nil {
				t.Fatalf("fromNative: %v", err)
			}

			if got.OrgID != "org1" {
				t.Errorf("org must come from the bound token, not the body: %q", got.OrgID)
			}
			if got.Project != want.Project {
				t.Errorf("project: got %q want %q", got.Project, want.Project)
			}
			if got.Component != want.Component {
				t.Errorf("component: got %q want %q", got.Component, want.Component)
			}
			if got.Title != want.Title {
				t.Errorf("title: got %q want %q", got.Title, want.Title)
			}
			if got.Summary != want.Summary {
				t.Errorf("summary: got %q want %q", got.Summary, want.Summary)
			}
			if got.Classification != want.Classification {
				t.Errorf("classification: got %q want %q", got.Classification, want.Classification)
			}
			// The one that must match to the byte — escalate.go reads it.
			if got.Diagnosis != want.Diagnosis {
				t.Errorf("diagnosis differs from the Python's.\n got: %q\nwant: %q",
					got.Diagnosis, want.Diagnosis)
			}
			if (got.IssueNumber == nil) != (want.IssueNumber == nil) {
				t.Fatalf("issueNumber presence: got %v want %v", got.IssueNumber, want.IssueNumber)
			}
			if got.IssueNumber != nil && *got.IssueNumber != *want.IssueNumber {
				t.Errorf("issueNumber: got %d want %d", *got.IssueNumber, *want.IssueNumber)
			}
			if got.IssueURL != want.IssueURL {
				t.Errorf("issueUrl: got %q want %q", got.IssueURL, want.IssueURL)
			}
			if got.IssueExcerpt != want.IssueExcerpt {
				t.Errorf("issueExcerpt: got %q want %q", got.IssueExcerpt, want.IssueExcerpt)
			}
			if got.Dispatched != want.Dispatched {
				t.Errorf("dispatched: got %v want %v", got.Dispatched, want.Dispatched)
			}
			if got.Recurrence != want.Recurrence {
				t.Errorf("recurrence: got %d want %d", got.Recurrence, want.Recurrence)
			}
		})
	}
}

// A decline files nothing, so the issue fields must stay unset. Recording an
// issue number here would put a dispatch on the console that never happened.
func TestFromNative_ADeclineCarriesNoIssueState(t *testing.T) {
	report, _ := loadGolden(t, "declined")

	got, err := fromNative("org1", report)
	if err != nil {
		t.Fatalf("fromNative: %v", err)
	}
	if got.IssueNumber != nil || got.IssueURL != "" || got.IssueExcerpt != "" {
		t.Errorf("a decline must carry no issue state, got %+v", got)
	}
	if got.Dispatched {
		t.Error("nothing was dispatched for a report with no issue")
	}
	if got.Recurrence != 0 {
		t.Errorf("recurrence is unknown without an issue, got %d", got.Recurrence)
	}
}

// The escalation decision's input, read as FIELDS. This replaced a regex over
// the rendered Markdown — so the property to pin is that the actions survive the
// trip out of the report with their statuses intact, since `suggested` is the
// whole signal that work is code-level.
func TestNativeActions_FeedTheEscalationDecisionAsFields(t *testing.T) {
	report, _ := loadGolden(t, "declined")

	code, config := splitActions(nativeActions(report))

	if len(code) != 1 || code[0] != "Investigate and remove the artificial delay in service2." {
		t.Fatalf("escalation must recover the code-level action, got %v", code)
	}
	if len(config) != 1 {
		t.Fatalf("and the config action as context, got %v", config)
	}
}

// An action carrying no status is neither code nor config, and is dropped rather
// than guessed at: escalating on it would file work off a status the remediation
// agent never asserted.
func TestNativeActions_AnUnclassifiedActionIsNotWork(t *testing.T) {
	report := map[string]any{
		"result": map[string]any{
			"recommendations": map[string]any{
				"recommended_actions": []any{
					map[string]any{"description": "Consider a dashboard"},
					map[string]any{"description": "Fix the retry", "status": "suggested"},
				},
			},
		},
	}
	actions := nativeActions(report)
	if len(actions) != 2 {
		t.Fatalf("both actions must be read, got %v", actions)
	}
	code, config := splitActions(actions)
	if len(code) != 1 || code[0] != "Fix the retry" {
		t.Errorf("only the suggested action is code-level work, got %v", code)
	}
	if len(config) != 0 {
		t.Errorf("an action with no status is not configuration either, got %v", config)
	}
}

// A report with no recommendations at all yields nothing, rather than a
// one-element slice of zero values that would escalate on an empty description.
func TestNativeActions_NoRecommendationsYieldsNothing(t *testing.T) {
	if got := nativeActions(map[string]any{}); got != nil {
		t.Errorf("got %v, want nil", got)
	}
	report, _ := loadGolden(t, "minimal")
	if got := nativeActions(report); len(got) != 0 {
		t.Errorf("a no-root-cause report has no actions, got %v", got)
	}
}

// The whole point of the decision section: the reasoning reaches a human. A
// report that files nothing is otherwise indistinguishable from one that never
// ran, and the console would assert "no actionable remediation" directly beneath
// remediation's own list of wanted code changes. Filing is unconditional now, so
// the only way a report carries no issue is a stage that crashed before it
// reached the receiver at all — `failure_reason` is that reasoning.
func TestRenderDiagnosis_PublishesAFailureReason(t *testing.T) {
	report, _ := loadGolden(t, "declined")

	d := renderDiagnosis(report)
	for _, want := range []string{
		"## Handoff decision",
		"No issue was filed for this alert, so no coding agent was dispatched.",
		"The delay is deliberate, but making it configurable hardens it.",
	} {
		if !contains(d, want) {
			t.Errorf("diagnosis must carry %q", want)
		}
	}
	// The decision outranks the evidence, because the string truncates from the end.
	if idxOf(d, "## Handoff decision") > idxOf(d, "## Timeline") {
		t.Error("the handoff decision must precede the timeline")
	}
}

// A report that cannot fill the row's NOT NULL columns is refused, and the 400
// names fields of the REPORT — an agent cannot fix "project" when its document
// has no such field. Each missing piece is named independently, so a caller
// fixing one is not sent round again for the next.
func TestFromNative_RefusesAReportItCannotStore(t *testing.T) {
	// Empty: nothing to take a project, a summary or any content from.
	_, err := fromNative("org1", map[string]any{})
	if err == nil {
		t.Fatal("an empty report must be refused")
	}
	for _, want := range []string{"alert_context.project", "summary", "result"} {
		if !contains(err.Error(), want) {
			t.Errorf("the refusal must name %q, got %v", want, err)
		}
	}

	// A summary alone DOES render a diagnosis, so only the project is missing —
	// the check reports what is actually absent, not a fixed list.
	_, err = fromNative("org1", map[string]any{"summary": "only a summary"})
	if err == nil {
		t.Fatal("a report with no alert context must be refused")
	}
	if !contains(err.Error(), "alert_context.project") {
		t.Errorf("must name the missing project, got %v", err)
	}
	if contains(err.Error(), "summary") || contains(err.Error(), "result") {
		t.Errorf("must not name what the report actually carried, got %v", err)
	}
}

// Fields sent alongside `report` are ignored rather than merged: two sources for
// one column, silently reconciled, is how a row comes to disagree with the
// report it was built from.
func TestFromNative_IgnoresFlatFieldsSentAlongside(t *testing.T) {
	report, want := loadGolden(t, "declined")

	got, err := fromNative("org1", report)
	if err != nil {
		t.Fatalf("fromNative: %v", err)
	}
	if got.Title != want.Title {
		t.Errorf("title must be derived from the report, got %q", got.Title)
	}
}

// The agent's StrEnum spells classifications with underscores and this contract
// with hyphens. An unrecognised value is not passed through: the read side
// treats it as a closed set.
func TestNativeClassification_NormalisesAndClosesTheSet(t *testing.T) {
	cases := map[string]string{
		"code_level":   "code-level",
		"config_level": "config-level",
		"mixed":        "mixed",
		"none":         "none",
		"":             "none",
		"something":    "none",
	}
	for in, want := range cases {
		report := map[string]any{"handoff": map[string]any{"classification": in}}
		if got := nativeClassification(report); got != want {
			t.Errorf("classification %q: got %q want %q", in, got, want)
		}
	}
	if got := nativeClassification(map[string]any{}); got != "none" {
		t.Errorf("no handoff at all: got %q want none", got)
	}
}

// Every current agent build carries classification nested under
// `handoff.result` — it is AE's own ae_create_issue answer, forwarded
// verbatim. An agent build from before that change sent it flat, so both must
// normalise and closed-set-check identically, and the nested shape must win
// when both happen to be present.
func TestNativeClassification_ReadsTheNestedResultFirst(t *testing.T) {
	nested := map[string]any{
		"handoff": map[string]any{
			"result": map[string]any{"classification": "code_level"},
		},
	}
	if got := nativeClassification(nested); got != "code-level" {
		t.Errorf("nested classification: got %q want %q", got, "code-level")
	}

	flat := map[string]any{
		"handoff": map[string]any{"classification": "config_level"},
	}
	if got := nativeClassification(flat); got != "config-level" {
		t.Errorf("flat fallback classification: got %q want %q", got, "config-level")
	}

	both := map[string]any{
		"handoff": map[string]any{
			"classification": "config_level",
			"result":         map[string]any{"classification": "mixed"},
		},
	}
	if got := nativeClassification(both); got != "mixed" {
		t.Errorf("the nested result must win over the flat field, got %q", got)
	}
}

// A report with no root cause still needs a headline, or the Alerts row is blank.
func TestNativeTitle_FallsBackToTheAlertName(t *testing.T) {
	report := map[string]any{"alert_context": map[string]any{"alert_name": "an alert"}}
	if got := nativeTitle(report); got != "an alert" {
		t.Errorf("got %q want %q", got, "an alert")
	}
	if got := nativeTitle(map[string]any{}); got != "RCA report" {
		t.Errorf("with nothing at all: got %q want %q", got, "RCA report")
	}
}

// Python slices these by CHARACTER. The agent's prose carries em-dashes, so a
// byte cut would both differ from the original and risk splitting a codepoint.
func TestTruncRunes_CutsCharactersNotBytes(t *testing.T) {
	if got := truncRunes("—————", 3); got != "———" {
		t.Errorf("got %q (%d bytes) want 3 runes", got, len(got))
	}
	if got := truncRunes("abc", 10); got != "abc" {
		t.Errorf("a short string must be untouched, got %q", got)
	}
}

func contains(haystack, needle string) bool { return idxOf(haystack, needle) >= 0 }

func idxOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}

// Our own facts now travel in the agent's opaque `provider_facts` bag, because
// the agent stamps them from the wire without understanding them. Reading them
// here is the other half of that split — and the flat fallback is what lets the
// two repos roll in either order, which is exactly the guarantee that was
// missing when this endpoint's flat body was removed in one step.
func TestProviderFact_ReadsTheBagAndTolerantlyFallsBack(t *testing.T) {
	nested := map[string]any{
		"provider_facts": map[string]any{"adopted": true, "recurrence": float64(3)},
	}
	if got := providerFact(nested, "adopted"); got != true {
		t.Errorf("nested adopted: got %v", got)
	}
	if got, ok := intIndex(providerFact(nested, "recurrence")); !ok || got != 3 {
		t.Errorf("nested recurrence: got %v ok=%v", got, ok)
	}

	// An agent older than provider_facts sent them flat.
	flat := map[string]any{"adopted": true, "recurrence": float64(2)}
	if got := providerFact(flat, "adopted"); got != true {
		t.Errorf("flat adopted: got %v", got)
	}
	if got, ok := intIndex(providerFact(flat, "recurrence")); !ok || got != 2 {
		t.Errorf("flat recurrence: got %v ok=%v", got, ok)
	}

	// The bag wins when both are present: it is the newer, authoritative shape.
	both := map[string]any{
		"adopted":        false,
		"provider_facts": map[string]any{"adopted": true},
	}
	if got := providerFact(both, "adopted"); got != true {
		t.Errorf("the bag must win over a legacy flat field, got %v", got)
	}

	// Absent everywhere is absent, not false: only the receiver can tell those
	// apart, and Dispatched already defaults false.
	if got := providerFact(map[string]any{}, "adopted"); got != nil {
		t.Errorf("missing must stay nil, got %v", got)
	}

	// handoff.result is AE's own ae_create_issue answer, carried verbatim, and
	// is more authoritative than either legacy shape: it must win a three-way
	// contest against both provider_facts and a flat field.
	all := map[string]any{
		"adopted":        false,
		"provider_facts": map[string]any{"adopted": false},
		"result":         map[string]any{"adopted": true},
	}
	if got := providerFact(all, "adopted"); got != true {
		t.Errorf("the nested result must win over both legacy shapes, got %v", got)
	}
}

// End to end through the row: a report whose facts are nested still records the
// dispatch state and attempt number the console shows.
func TestFromNative_ReadsDispatchAndRecurrenceFromProviderFacts(t *testing.T) {
	report, _ := loadGolden(t, "filed")
	handoff := report["handoff"].(map[string]any)
	// Re-shape the golden's flat facts the way the current agent sends them.
	handoff["provider_facts"] = map[string]any{
		"adopted":    handoff["adopted"],
		"recurrence": handoff["recurrence"],
	}
	delete(handoff, "adopted")
	delete(handoff, "recurrence")

	got, err := fromNative("org1", report)
	if err != nil {
		t.Fatalf("fromNative: %v", err)
	}
	if !got.Dispatched {
		t.Error("dispatched must be read out of provider_facts")
	}
	if got.Recurrence != 3 {
		t.Errorf("recurrence: got %d want 3", got.Recurrence)
	}
}

// End to end through the row: a report whose issue facts are nested under
// handoff.result — the shape every current agent build sends, since it is
// AE's own ae_create_issue answer carried verbatim — still records
// IssueNumber and IssueURL. The old flat shape must keep working too, since
// the two repos' new builds can reach production in either order.
func TestFromNative_ReadsIssueNumberAndURLFromNestedResult(t *testing.T) {
	report, _ := loadGolden(t, "filed")
	handoff := report["handoff"].(map[string]any)
	// Re-shape the golden's flat issue facts the way the current agent sends
	// them: nested under `result`, alongside the other ae_create_issue facts.
	handoff["result"] = map[string]any{
		"number":         handoff["created_issue_number"],
		"url":            handoff["created_issue_url"],
		"classification": handoff["classification"],
		"deduped":        handoff["deduped"],
		"adopted":        handoff["adopted"],
		"recurrence":     handoff["recurrence"],
	}
	delete(handoff, "created_issue_number")
	delete(handoff, "created_issue_url")
	delete(handoff, "classification")
	delete(handoff, "adopted")
	delete(handoff, "recurrence")

	got, err := fromNative("org1", report)
	if err != nil {
		t.Fatalf("fromNative: %v", err)
	}
	if got.IssueNumber == nil || *got.IssueNumber != 41 {
		t.Errorf("issueNumber: got %v want 41", got.IssueNumber)
	}
	if got.IssueURL != "https://gh/x/41" {
		t.Errorf("issueUrl: got %q want %q", got.IssueURL, "https://gh/x/41")
	}
	if got.Classification != "code-level" {
		t.Errorf("classification: got %q want %q", got.Classification, "code-level")
	}
	if !got.Dispatched {
		t.Error("dispatched must still be read out of the nested result")
	}
	if got.Recurrence != 3 {
		t.Errorf("recurrence: got %d want 3", got.Recurrence)
	}

	// The old flat shape, unchanged, must still produce the identical row.
	oldShape, _ := loadGolden(t, "filed")
	gotOld, err := fromNative("org1", oldShape)
	if err != nil {
		t.Fatalf("fromNative (flat): %v", err)
	}
	if gotOld.IssueNumber == nil || *gotOld.IssueNumber != 41 {
		t.Errorf("flat issueNumber: got %v want 41", gotOld.IssueNumber)
	}
	if gotOld.IssueURL != "https://gh/x/41" {
		t.Errorf("flat issueUrl: got %q want %q", gotOld.IssueURL, "https://gh/x/41")
	}
}

// The regression test: this is the exact shape a real successful handoff now
// produces (AE's ae_create_issue answer, carried verbatim under
// `handoff.result`). Before this fix, nativeClassification and IssueNumber
// both read the old flat fields, which are never populated in this shape —
// so IssueNumber stayed nil and escalate.go's shouldEscalate, which gates
// solely on `r.IssueNumber != nil`, would treat an already-filed issue as
// unfiled and dispatch a duplicate. Proving IssueNumber is non-nil here is
// exactly what proves that duplicate can no longer happen.
func TestFromNative_ARealHandoffResultDoesNotLookUnfiled(t *testing.T) {
	report := map[string]any{
		"alert_context": map[string]any{"project": "demohello", "component": "svc1"},
		"summary":       "svc1 latency breached its SLO",
		"handoff": map[string]any{
			"tool": "ae_create_issue",
			"result": map[string]any{
				"number":         float64(41),
				"url":            "https://x/41",
				"classification": "code-level",
				"deduped":        false,
			},
		},
	}

	got, err := fromNative("org1", report)
	if err != nil {
		t.Fatalf("fromNative: %v", err)
	}
	if got.IssueNumber == nil {
		t.Fatal("IssueNumber must be set from a real handoff.result — a nil here " +
			"is exactly the bug that files a duplicate escalation issue")
	}
	if *got.IssueNumber != 41 {
		t.Errorf("issueNumber: got %d want 41", *got.IssueNumber)
	}
	if got.Classification != "code-level" {
		t.Errorf("classification: got %q want %q", got.Classification, "code-level")
	}
}
