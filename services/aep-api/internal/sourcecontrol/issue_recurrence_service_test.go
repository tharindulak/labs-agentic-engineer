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
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/secrets"
)

// recurGitHub extends the dedupe fake with the three writes a recurrence makes,
// and RECORDS THEIR ORDER — because the order is a correctness property, not a
// style: the body is replaced wholesale, and doing that after reopening would
// expose the issue to a run that could be reading it.
type recurGitHub struct {
	fakeGitHub
	reads    []int
	edits    map[int]string
	reopened []int
	order    []string
	failEdit bool
}

func newRecurGitHub() *recurGitHub {
	return &recurGitHub{edits: map[int]string{}}
}

func (f *recurGitHub) GetIssue(_ context.Context, _, _ string, _ secrets.Credential, number int) (*IssueInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reads = append(f.reads, number)
	for i := range f.issues {
		if f.issues[i].Number == number {
			iss := f.issues[i]
			return &iss, nil
		}
	}
	return nil, ErrIssueNotFound
}

func (f *recurGitHub) EditIssueBody(_ context.Context, _, _ string, _ secrets.Credential, number int, body string) error {
	if f.failEdit {
		return errors.New("github said no")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.order = append(f.order, "edit")
	f.edits[number] = body
	for i := range f.issues {
		if f.issues[i].Number == number {
			f.issues[i].Body = body
		}
	}
	return nil
}

func (f *recurGitHub) ReopenIssue(_ context.Context, _, _ string, _ secrets.Credential, number int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.order = append(f.order, "reopen")
	f.reopened = append(f.reopened, number)
	for i := range f.issues {
		if f.issues[i].Number == number {
			f.issues[i].State = "open"
			f.issues[i].StateReason = ""
		}
	}
	return nil
}

// seedClosedIncident puts a closed, completed, SRE-filed issue in the fake,
// carrying the dedupe label the given key maps to.
func (f *recurGitHub) seedClosedIncident(key, body string, extraLabels ...string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nextNum++
	labels := append([]string{dedupeLabelFor(key), LabelSREAgent}, extraLabels...)
	f.issues = append(f.issues, IssueInfo{
		Number: f.nextNum, Title: "the original incident", Body: body,
		URL: "https://github.com/o/r/issues/40", State: "closed",
		StateReason: stateReasonCompleted, Labels: labels,
	})
	return f.nextNum
}

const incidentKey = "sre-rca/checkout/9f2c1a"

// The headline behaviour: the same incident recurring reopens ITS issue instead
// of filing a second one, so the history of what was already tried survives.
func TestCreateIssue_RecurrenceReopensInsteadOfFiling(t *testing.T) {
	gh := newRecurGitHub()
	n := gh.seedClosedIncident(incidentKey, "## Scope\n\nnull deref on checkout\n")
	svc := NewIssueService(fakeRepoRepo{}, gh, fakeResolver{})

	got, err := svc.CreateIssue(context.Background(), "org", "proj",
		CreateIssueRequest{Title: "checkout 500s again", Body: "same trace, new occurrence", DedupeKey: incidentKey})
	if err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}

	if gh.createCount != 0 {
		t.Fatalf("filed %d new issues; a recurrence must reopen, not re-file", gh.createCount)
	}
	if !got.Reopened || got.Number != n {
		t.Fatalf("got %+v, want the existing issue %d reopened", got, n)
	}
	if got.Deduped {
		t.Error("deduped and reopened are opposite outcomes and must never both be true")
	}
	if got.Recurrence != 2 {
		t.Errorf("Recurrence = %d, want 2 (the first recurrence is attempt 2)", got.Recurrence)
	}
	if len(gh.reopened) != 1 || gh.reopened[0] != n {
		t.Errorf("reopened %v, want [%d]", gh.reopened, n)
	}
	body := gh.edits[n]
	if !strings.Contains(body, "## Scope") {
		t.Error("the original body must survive — the thread is the point")
	}
	if !strings.Contains(body, "## Recurrence 2") || !strings.Contains(body, "same trace, new occurrence") {
		t.Errorf("the new evidence must land in the body:\n%s", body)
	}
	// Append THEN reopen: every write happens while the issue is still closed
	// and outside every working set, so a whole-body replace cannot race a run.
	if want := []string{"edit", "reopen"}; !equalStrings(gh.order, want) {
		t.Errorf("write order = %v, want %v — reopening first opens a race for no gain", gh.order, want)
	}
}

// The read that reopening is decided from is narrowed to incident issues, which
// is what keeps a single-page list from hiding the issue worth reopening.
func TestCreateIssue_RecurrenceLookupAsksForTheSREAgentLabel(t *testing.T) {
	gh := &labelSpyGitHub{recurGitHub: newRecurGitHub()}
	gh.seedClosedIncident(incidentKey, "body")
	svc := NewIssueService(fakeRepoRepo{}, gh, fakeResolver{})

	if _, err := svc.CreateIssue(context.Background(), "org", "proj",
		CreateIssueRequest{Title: "t", Body: "b", DedupeKey: incidentKey}); err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}
	var narrowed bool
	for _, q := range gh.queries {
		if len(q) == 2 && q[1] == LabelSREAgent {
			narrowed = true
		}
	}
	if !narrowed {
		t.Errorf("the recurrence lookup must ask GitHub for the incident label; queries were %v", gh.queries)
	}
}

type labelSpyGitHub struct {
	*recurGitHub
	queries [][]string
}

func (f *labelSpyGitHub) ListIssues(ctx context.Context, o, r string, c secrets.Credential, labels []string) ([]IssueInfo, error) {
	f.queries = append(f.queries, append([]string(nil), labels...))
	return f.recurGitHub.ListIssues(ctx, o, r, c, labels)
}

// A human who closed an incident as "not planned" has decided. No fingerprint
// match may overrule that — the platform files a fresh issue instead, which a
// human can close again in ten seconds.
func TestCreateIssue_NotPlannedIsNeverReopened(t *testing.T) {
	gh := newRecurGitHub()
	n := gh.seedClosedIncident(incidentKey, "body")
	gh.issues[0].StateReason = stateReasonNotPlanned
	svc := NewIssueService(fakeRepoRepo{}, gh, fakeResolver{})

	got, err := svc.CreateIssue(context.Background(), "org", "proj",
		CreateIssueRequest{Title: "t", Body: "b", DedupeKey: incidentKey})
	if err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}
	if got.Reopened || len(gh.reopened) != 0 {
		t.Fatalf("got %+v (reopened %v); a not_planned close must never be reopened",
			got, gh.reopened)
	}
	// It used to file a fresh issue here. It no longer does: `not_planned` is
	// somebody's decision that this needs no work, and asking again by filing a
	// duplicate is how one fixture alert became an unbounded series of coding
	// cycles (ADR-0023). The decision is returned instead.
	if !got.Suppressed || got.Number != n {
		t.Fatalf("got %+v, want suppression pointing at the decided issue %d", got, n)
	}
	if gh.createCount != 0 {
		t.Errorf("filed %d issues; the decision stands until a human reopens it", gh.createCount)
	}
}

// An OPEN issue under the key is ordinary dedupe, and its own run owns its
// dispatch. Reopening logic must not touch it.
func TestCreateIssue_OpenIssueStillDedupes(t *testing.T) {
	gh := newRecurGitHub()
	n := gh.seedClosedIncident(incidentKey, "b\n\n## Recurrence 2\n\nx\n")
	gh.issues[0].State = "open"
	gh.issues[0].StateReason = ""
	svc := NewIssueService(fakeRepoRepo{}, gh, fakeResolver{})

	got, err := svc.CreateIssue(context.Background(), "org", "proj",
		CreateIssueRequest{Title: "t", Body: "b", DedupeKey: incidentKey})
	if err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}
	if !got.Deduped || got.Number != n {
		t.Fatalf("got %+v, want a dedupe onto %d", got, n)
	}
	if got.Reopened {
		t.Error("an open issue is not a recurrence")
	}
	// Free from the list the dedupe already read: a human triaging sees which
	// attempt the open issue is on rather than a bare "already exists".
	if got.Recurrence != 2 {
		t.Errorf("Recurrence = %d, want 2 read from the existing body", got.Recurrence)
	}
	if len(gh.reopened) != 0 || len(gh.edits) != 0 {
		t.Error("dedupe must write nothing")
	}
}

// A closed issue that is not incident work must not be resurrected by a dedupe
// key it happens to share.
func TestCreateIssue_ClosedNonIncidentWorkIsNotReopened(t *testing.T) {
	gh := newRecurGitHub()
	gh.mu.Lock()
	gh.nextNum++
	gh.issues = append(gh.issues, IssueInfo{
		Number: gh.nextNum, State: "closed", StateReason: stateReasonCompleted,
		Labels: []string{dedupeLabelFor(incidentKey), "aep"},
	})
	gh.mu.Unlock()
	svc := NewIssueService(fakeRepoRepo{}, gh, fakeResolver{})

	got, err := svc.CreateIssue(context.Background(), "org", "proj",
		CreateIssueRequest{Title: "t", Body: "b", DedupeKey: incidentKey})
	if err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}
	if got.Reopened {
		t.Error("only incident work recurs")
	}
	if gh.createCount != 1 {
		t.Errorf("filed %d issues, want 1", gh.createCount)
	}
}

// An unrecorded incident is the one outcome nothing recovers from. If reopening
// fails half-way, the issue must still be FILED — degrading to the old
// duplicate-issue behaviour, never to silence.
func TestCreateIssue_AFailedReopenStillFilesTheIncident(t *testing.T) {
	gh := newRecurGitHub()
	gh.seedClosedIncident(incidentKey, "body")
	gh.failEdit = true
	svc := NewIssueService(fakeRepoRepo{}, gh, fakeResolver{})

	got, err := svc.CreateIssue(context.Background(), "org", "proj",
		CreateIssueRequest{Title: "t", Body: "b", DedupeKey: incidentKey})
	if err != nil {
		t.Fatalf("a failed reopen must not fail the create: %v", err)
	}
	if got.Reopened {
		t.Error("nothing was reopened")
	}
	if gh.createCount != 1 {
		t.Errorf("filed %d issues, want the incident recorded once", gh.createCount)
	}
}

// Recurrence is deliberately unbounded in time: an incident that resurfaces
// after many attempts still reopens, and still escalates rather than stopping.
func TestCreateIssue_LaterRecurrencesKeepCountingAndEscalate(t *testing.T) {
	gh := newRecurGitHub()
	n := gh.seedClosedIncident(incidentKey, "b\n\n## Recurrence 2\n\nx\n\n## Recurrence 3\n\ny\n")
	svc := NewIssueService(fakeRepoRepo{}, gh, fakeResolver{})

	got, err := svc.CreateIssue(context.Background(), "org", "proj",
		CreateIssueRequest{Title: "t", Body: "still broken", DedupeKey: incidentKey})
	if err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}
	if got.Recurrence != 4 {
		t.Fatalf("Recurrence = %d, want 4", got.Recurrence)
	}
	if !strings.Contains(gh.edits[n], "Escalated") {
		t.Errorf("attempt 4 must escalate:\n%s", gh.edits[n])
	}
	// Escalation reports; it never refuses.
	if !got.Reopened {
		t.Error("escalation must not stop the platform working the incident")
	}
}

func equalStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// --- the unverified fix (ADR-0022) ------------------------------------------
//
// A low-confidence fix merges and its issue is left OPEN with `aep` removed:
// shipped, recorded, worked by nobody. When the incident comes back, that issue
// is the thread to continue — but it is open, and every open issue used to
// dedupe, so the recurrence would have been swallowed with no evidence, no
// attempt count and nobody dispatched.

func (f *recurGitHub) seedUnverified(key, body string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nextNum++
	f.issues = append(f.issues, IssueInfo{
		Number: f.nextNum, Title: "the original incident", Body: body,
		URL: "https://github.com/o/r/issues/40", State: "open",
		// Adopted (`aep:codingagent` records that and is never removed), then
		// stood down when its unverified fix merged (`aep` taken off).
		Labels: []string{dedupeLabelFor(key), LabelSREAgent, LabelAdopt},
	})
	return f.nextNum
}

func TestCreateIssue_RecurrenceOnAnUnverifiedFixContinuesTheSameThread(t *testing.T) {
	gh := newRecurGitHub()
	n := gh.seedUnverified(incidentKey, "## Scope\n\nnull deref on checkout\n")
	svc := NewIssueService(fakeRepoRepo{}, gh, fakeResolver{})

	got, err := svc.CreateIssue(context.Background(), "org", "proj",
		CreateIssueRequest{Title: "checkout 500s again", Body: "same trace, new occurrence", DedupeKey: incidentKey})
	if err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}
	if got.Deduped {
		t.Fatal("an unverified fix is worked by nobody — folding onto it records the recurrence nowhere")
	}
	if !got.Reopened || got.Number != n {
		t.Fatalf("got %+v, want the unverified issue %d continued", got, n)
	}
	if got.Recurrence != 2 {
		t.Errorf("Recurrence = %d, want 2", got.Recurrence)
	}
	if body := gh.edits[n]; !strings.Contains(body, "## Recurrence 2") ||
		!strings.Contains(body, "same trace, new occurrence") {
		t.Errorf("the new evidence must land on the same thread:\n%s", body)
	}
	// It was never closed, so there is nothing to reopen — and a spurious
	// "reopened" event on an issue that never closed is a lie in the timeline.
	if len(gh.reopened) != 0 {
		t.Errorf("reopened %v; an unverified issue is already open", gh.reopened)
	}
	if gh.createCount != 0 {
		t.Errorf("filed %d new issues; the thread already exists", gh.createCount)
	}
}

// The carve-out must stay narrow. An ordinary open issue — including an
// SRE-filed one that was never adopted (a ledger entry, `adopt: false`) — still
// dedupes, because that is what stops concurrent alert handlers filing
// duplicates for one incident.
func TestCreateIssue_AnOpenNonAdoptedIncidentIssueStillDedupes(t *testing.T) {
	gh := newRecurGitHub()
	gh.mu.Lock()
	gh.nextNum++
	n := gh.nextNum
	gh.issues = append(gh.issues, IssueInfo{
		Number: n, State: "open",
		Labels: []string{dedupeLabelFor(incidentKey), LabelSREAgent}, // no aep:codingagent
	})
	gh.mu.Unlock()
	svc := NewIssueService(fakeRepoRepo{}, gh, fakeResolver{})

	got, err := svc.CreateIssue(context.Background(), "org", "proj",
		CreateIssueRequest{Title: "t", Body: "b", DedupeKey: incidentKey})
	if err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}
	if !got.Deduped || got.Number != n {
		t.Fatalf("got %+v, want a dedupe onto %d", got, n)
	}
}

func TestIsUnverifiedFix(t *testing.T) {
	cases := []struct {
		name   string
		labels []string
		want   bool
	}{
		{"adopted then stood down", []string{LabelSREAgent, LabelAdopt}, true},
		{"still agent work", []string{LabelSREAgent, LabelAdopt, LabelAgentWork}, false},
		{"never adopted", []string{LabelSREAgent}, false},
		{"not incident work", []string{LabelAdopt}, false},
		{"nothing at all", nil, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := IsUnverifiedFix(IssueInfo{State: "open", Labels: c.labels}); got != c.want {
				t.Fatalf("IsUnverifiedFix(%v) = %v, want %v", c.labels, got, c.want)
			}
		})
	}
}

// --- the no-change verdict (ADR-0023) ---------------------------------------
//
// Some incidents cannot be fixed in code: the behaviour being reported is what
// the acceptance criteria REQUIRE. A coding agent that works that out closes the
// issue as `not_planned`. Without the suppression below, the next identical
// alert files a fresh issue and pays another whole coding cycle to be told the
// same thing — which, on a fixture whose specified behaviour trips its own
// alert, is every single request forever.

func (f *recurGitHub) seedDecided(key, reason string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nextNum++
	f.issues = append(f.issues, IssueInfo{
		Number: f.nextNum, Title: "the original incident", State: "closed",
		StateReason: reason, URL: "https://github.com/o/r/issues/40",
		Labels: []string{dedupeLabelFor(key), LabelSREAgent, LabelAdopt},
	})
	return f.nextNum
}

func TestCreateIssue_ADecidedSignatureIsSuppressed(t *testing.T) {
	gh := newRecurGitHub()
	n := gh.seedDecided(incidentKey, stateReasonNotPlanned)
	svc := NewIssueService(fakeRepoRepo{}, gh, fakeResolver{})

	got, err := svc.CreateIssue(context.Background(), "org", "proj",
		CreateIssueRequest{Title: "t", Body: "b", DedupeKey: incidentKey})
	if err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}
	if !got.Suppressed || got.Number != n {
		t.Fatalf("got %+v, want suppression pointing at the decided issue %d", got, n)
	}
	if gh.createCount != 0 {
		t.Errorf("filed %d issues; the question already has an answer", gh.createCount)
	}
	// Nothing is reopened: the platform does not overrule somebody who looked
	// at the code and decided against the work.
	if len(gh.reopened) != 0 || got.Reopened {
		t.Error("a decided signature must not be resurrected")
	}
}

// The carve-out is `not_planned` ONLY. A `completed` close is a fix that landed,
// and the same signature coming back after it is a recurrence, not a decision.
func TestCreateIssue_ACompletedCloseIsStillARecurrenceNotASuppression(t *testing.T) {
	gh := newRecurGitHub()
	gh.seedDecided(incidentKey, stateReasonCompleted)
	svc := NewIssueService(fakeRepoRepo{}, gh, fakeResolver{})

	got, err := svc.CreateIssue(context.Background(), "org", "proj",
		CreateIssueRequest{Title: "t", Body: "b", DedupeKey: incidentKey})
	if err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}
	if got.Suppressed {
		t.Fatal("a merged fix that did not hold is a recurrence — it must be worked again")
	}
	if !got.Reopened {
		t.Fatalf("got %+v, want the thread reopened", got)
	}
}

func TestIsNoChangeVerdict(t *testing.T) {
	cases := []struct {
		name        string
		state       string
		stateReason string
		labels      []string
		want        bool
	}{
		{"agent decided against it", "closed", stateReasonNotPlanned, []string{LabelSREAgent}, true},
		{"a fix landed", "closed", stateReasonCompleted, []string{LabelSREAgent}, false},
		{"still open", "open", "", []string{LabelSREAgent}, false},
		// Only incident work carries this meaning; an ordinary task closed as
		// not planned says nothing about an alert signature.
		{"not incident work", "closed", stateReasonNotPlanned, []string{"aep"}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := IsNoChangeVerdict(IssueInfo{State: c.state, StateReason: c.stateReason, Labels: c.labels})
			if got != c.want {
				t.Fatalf("IsNoChangeVerdict = %v, want %v", got, c.want)
			}
		})
	}
}
