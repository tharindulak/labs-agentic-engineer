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

package codingagent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/gitfs"
)

// fakeRecordSource serves scripted pages. The LAST page repeats, which is what
// a real pod log does between two polls that saw no new output.
type fakeRecordSource struct {
	mu    sync.Mutex
	pages []LiveTail
	since []int64 // the sinceSeconds of every call, in order
	err   error
	seen  chan struct{}
}

func (f *fakeRecordSource) ReadSince(_ context.Context, _, _, _ string, since int64) (LiveTail, error) {
	f.mu.Lock()
	f.since = append(f.since, since)
	n := len(f.since) - 1
	pages, err := f.pages, f.err
	seen := f.seen
	f.mu.Unlock()
	if seen != nil {
		select {
		case seen <- struct{}{}:
		default:
		}
	}
	if err != nil {
		return LiveTail{}, err
	}
	if n >= len(pages) {
		n = len(pages) - 1
	}
	if n < 0 {
		return LiveTail{}, nil
	}
	return pages[n], nil
}

func (f *fakeRecordSource) sinceCalls() []int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]int64{}, f.since...)
}

// v1Line renders one runner NDJSON line in the pod's `timestamps=true` shape.
func v1Line(seq int, at time.Time, body string) string {
	return fmt.Sprintf("%s {\"schemaVersion\":1,\"ts\":%q,\"seq\":%d,%s}",
		at.UTC().Format(time.RFC3339Nano), at.UTC().Format(time.RFC3339Nano), seq, body)
}

func runningPod() openchoreo.RuntimePod {
	return openchoreo.RuntimePod{Found: true, Name: "p1", Phase: "Running"}
}

func succeededPod() openchoreo.RuntimePod {
	return openchoreo.RuntimePod{Found: true, Name: "p1", Phase: "Succeeded"}
}

// recorderFixture wires a recorder over a temp workspace root and returns the
// pieces a test drives.
type recorderFixture struct {
	rec   *CycleRecorder
	store *RecordingStore
	src   *fakeRecordSource
	root  string
	cycle *delivery.RunCycle
}

func newRecorderFixture(t *testing.T, pages ...LiveTail) *recorderFixture {
	t.Helper()
	root := t.TempDir()
	store := NewRecordingStore(root, 0)
	src := &fakeRecordSource{pages: pages, seen: make(chan struct{}, 64)}
	cyc := liveCycle("c1")
	cyc.Attempts = 1
	return &recorderFixture{
		rec:   NewCycleRecorder(src, store),
		store: store,
		src:   src,
		root:  root,
		cycle: cyc,
	}
}

// session builds a session WITHOUT its goroutine, so a test drives poll() one
// call at a time instead of racing a ticker.
func (f *recorderFixture) session(t *testing.T, attempt int) *recordingSession {
	t.Helper()
	cyc := *f.cycle
	cyc.Attempts = attempt
	s := newRecordingSession(f.rec, &cyc)
	cur, err := f.store.Begin(cyc.OrgID, cyc.ID, attempt)
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	s.cur = cur
	return s
}

// meta reads the cycle's state.json — the one file a reader still has after the
// pod is gone, so what it says has to agree with the events beside it.
func (f *recorderFixture) meta(t *testing.T) recordingMeta {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(gitfs.RunsDir(f.root), "acme", "c1", recordingStateFile))
	if err != nil {
		t.Fatalf("read state.json: %v", err)
	}
	var m recordingMeta
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("parse state.json: %v", err)
	}
	return m
}

// recorded reads back everything the recorder wrote for one attempt.
func (f *recorderFixture) recorded(t *testing.T, attempt int) []gen.RunEvent {
	t.Helper()
	events, _, err := f.store.ReadFrom("acme", "c1", attempt, 0)
	if err != nil {
		t.Fatalf("ReadFrom: %v", err)
	}
	return events
}

// TestRecorder_RecordsTheFeedAndClosesCompleteOnATerminalPod is the happy path,
// plus the ONE FINAL FULL READ that closes the "pod exited between two polls"
// loss: the runner's last words land after the last incremental read, so the
// recorder asks for the whole log once more before it closes.
func TestRecorder_RecordsTheFeedAndClosesCompleteOnATerminalPod(t *testing.T) {
	t.Parallel()

	at := time.Date(2026, 9, 4, 9, 25, 39, 0, time.UTC)
	page1 := LiveTail{Pod: runningPod(), Text: strings.Join([]string{
		v1Line(1, at, `"kind":"tool_use","tool":"Read","summary":"read api.go"`),
		v1Line(2, at.Add(time.Second), `"kind":"tool_result","tool":"Read","ok":true`),
		"",
	}, "\n")}
	// The terminal page carries the run's ending — the line a poll-interval-short
	// reader used to miss every time.
	page2 := LiveTail{Pod: succeededPod(), Text: strings.Join([]string{
		v1Line(1, at, `"kind":"tool_use","tool":"Read","summary":"read api.go"`),
		v1Line(2, at.Add(time.Second), `"kind":"tool_result","tool":"Read","ok":true`),
		v1Line(3, at.Add(2*time.Second), `"kind":"result","status":"success"`),
		"",
	}, "\n")}

	f := newRecorderFixture(t, page1, page2)
	s := f.session(t, 1)

	if done, phase := s.poll(context.Background()); done || phase != "Running" {
		t.Fatalf("first poll = (done=%v, phase=%q), want (false, Running)", done, phase)
	}
	if got := f.store.State("acme", "c1"); got != gen.RunCycleViewRecordingRecording {
		t.Fatalf("state mid-run = %q, want recording", got)
	}
	if done, _ := s.poll(context.Background()); !done {
		t.Fatal("a terminal pod did not end the session")
	}
	if got := f.store.State("acme", "c1"); got != gen.RunCycleViewRecordingComplete {
		t.Fatalf("state = %q, want complete", got)
	}

	events := f.recorded(t, 1)
	if len(events) != 3 {
		t.Fatalf("recorded %d events, want 3 (the overlap must be deduped)\n%+v", len(events), events)
	}
	if events[2].Kind != gen.RunEventKindRunSettled || events[2].Outcome != gen.RunEventOutcomeSuccess {
		t.Errorf("last recorded event = %+v, want the run's own settle", events[2])
	}
	// Call 1 asks for the whole log, call 2 uses the time cursor, and call 3 is
	// the final FULL read.
	calls := f.src.sinceCalls()
	if len(calls) != 3 || calls[0] != 0 || calls[1] == 0 || calls[2] != 0 {
		t.Errorf("sinceSeconds calls = %v, want [0, >0, 0] — the last one is the final full read", calls)
	}
}

// TestRecorder_SeqGapBecomesANoticeAndFlipsTheState covers the loss the gap
// detector exists for. It runs in the PRODUCER's numbering: a lifted v1 feed
// occupies only the even v2 seqs, so a detector reading those would call every
// single step a missing event.
func TestRecorder_SeqGapBecomesANoticeAndFlipsTheState(t *testing.T) {
	t.Parallel()

	at := time.Date(2026, 9, 4, 9, 25, 39, 0, time.UTC)
	page := LiveTail{Pod: runningPod(), Text: strings.Join([]string{
		v1Line(1, at, `"kind":"log","summary":"one"`),
		v1Line(5, at.Add(time.Second), `"kind":"log","summary":"five"`),
		"",
	}, "\n")}

	f := newRecorderFixture(t, page)
	s := f.session(t, 1)
	if done, _ := s.poll(context.Background()); done {
		t.Fatal("a Running pod ended the session")
	}
	if got := f.store.State("acme", "c1"); got != gen.RunCycleViewRecordingGaps {
		t.Fatalf("state = %q, want gaps", got)
	}

	events := f.recorded(t, 1)
	var notice *gen.RunEvent
	for i := range events {
		if events[i].Code == gen.RunEventCodeGap {
			notice = &events[i]
		}
	}
	if notice == nil {
		t.Fatalf("no gap notice in %+v", events)
	}
	if notice.Kind != gen.RunEventKindNotice || notice.Level != gen.RunEventLevelWarn || notice.AgentID != leadAgentID {
		t.Errorf("gap notice = %+v, want a warn notice on the lead", notice)
	}
	if !strings.Contains(notice.Detail, "3 event(s)") {
		t.Errorf("detail = %q, want it to name how many went missing (seqs 2,3,4)", notice.Detail)
	}
	// It sits WHERE the hole is: after the last recorded event and before the
	// one that revealed it.
	if events[0].Seq >= notice.Seq || notice.Seq >= events[len(events)-1].Seq {
		t.Errorf("gap notice seq %d is not between %d and %d", notice.Seq, events[0].Seq, events[len(events)-1].Seq)
	}
}

// TestRecorder_ArchiveBackfillRepairsAGapWithNoNotice pins the archive's ONE
// remaining job. It indexed the same pod's output all along, so a burst the
// platform's own read missed may still be there — and a gap that is fully
// recovered is not a gap.
func TestRecorder_ArchiveBackfillRepairsAGapWithNoNotice(t *testing.T) {
	t.Parallel()

	at := time.Date(2026, 9, 4, 9, 25, 39, 0, time.UTC)
	page := LiveTail{Pod: runningPod(), Text: strings.Join([]string{
		v1Line(1, at, `"kind":"log","summary":"one"`),
		v1Line(4, at.Add(3*time.Second), `"kind":"log","summary":"four"`),
		"",
	}, "\n")}
	archive := strings.Join([]string{
		v1Line(1, at, `"kind":"log","summary":"one"`),
		v1Line(2, at.Add(time.Second), `"kind":"log","summary":"two"`),
		v1Line(3, at.Add(2*time.Second), `"kind":"log","summary":"three"`),
		v1Line(4, at.Add(3*time.Second), `"kind":"log","summary":"four"`),
		"",
	}, "\n")

	f := newRecorderFixture(t, page)
	f.rec.WithArchive(&stubArchive{text: archive})
	s := f.session(t, 1)
	if done, _ := s.poll(context.Background()); done {
		t.Fatal("a Running pod ended the session")
	}
	if got := f.store.State("acme", "c1"); got != gen.RunCycleViewRecordingRecording {
		t.Fatalf("state = %q — a fully backfilled gap is not a gap", got)
	}
	events := f.recorded(t, 1)
	if len(events) != 4 {
		t.Fatalf("recorded %d events, want all four\n%+v", len(events), events)
	}
	for i := range events {
		if events[i].Code == gen.RunEventCodeGap {
			t.Errorf("a repaired gap still reported a notice: %+v", events[i])
		}
	}
}

// TestRecorder_CancelClosesWithRunSettledCancelledAndGaps covers the fourth
// loss: cancel deletes the Component immediately, so the pod's log is
// unreadable from that instant and the last poll interval is genuinely gone.
// The recording therefore says so — `gaps` — and carries a runner-less settle
// so a reader can see the run ENDED rather than merely stopped talking.
func TestRecorder_CancelClosesWithRunSettledCancelledAndGaps(t *testing.T) {
	t.Parallel()

	at := time.Date(2026, 9, 4, 9, 25, 39, 0, time.UTC)
	page := LiveTail{Pod: runningPod(), Text: v1Line(1, at, `"kind":"log","summary":"working"`) + "\n"}

	f := newRecorderFixture(t, page)
	s := f.session(t, 1)
	if done, _ := s.poll(context.Background()); done {
		t.Fatal("a Running pod ended the session")
	}

	f.rec.CloseCancelled(context.Background(), f.cycle)

	if got := f.store.State("acme", "c1"); got != gen.RunCycleViewRecordingGaps {
		t.Fatalf("state = %q, want gaps — the tail between the last poll and the delete is lost", got)
	}
	if !f.store.Finished("acme", "c1", 1) {
		t.Error("a cancelled recording was left open")
	}
	events := f.recorded(t, 1)
	last := events[len(events)-1]
	if last.Kind != gen.RunEventKindRunSettled {
		t.Fatalf("last recorded event = %+v, want run_settled", last)
	}
	// `cancelled` is deliberately not `failure`: the work was taken away, and
	// nothing went wrong.
	if last.Outcome != gen.RunEventOutcomeCancelled {
		t.Errorf("outcome = %q, want cancelled", last.Outcome)
	}
	if last.Error != "" {
		t.Errorf("a cancelled settle invented an error: %q", last.Error)
	}
	if last.Seq <= events[0].Seq {
		t.Errorf("the settle sits at seq %d, at or before the feed it closes (%d)", last.Seq, events[0].Seq)
	}
}

// TestRecorder_CancelOnAnUnrecordedCycleWritesNothing pins that cancel does not
// mint a recording for a cycle the platform never recorded: that would turn
// `none` into a one-event feed and hide the fact that nothing was captured.
func TestRecorder_CancelOnAnUnrecordedCycleWritesNothing(t *testing.T) {
	t.Parallel()

	f := newRecorderFixture(t)
	f.rec.CloseCancelled(context.Background(), f.cycle)
	if got := f.store.State("acme", "c1"); got != gen.RunCycleViewRecordingNone {
		t.Fatalf("state = %q, want none", got)
	}
}

// TestRecorder_ReDispatchWritesASecondAttemptFileAndLeavesTheFirst covers the
// fifth loss. A re-dispatch is a new pod whose seqs restart at 1: one file per
// attempt is what keeps two events numbered `1` from colliding in a consumer
// that dedups on (cycle, attempt, seq), and the first attempt's history is not
// rewritten by the retry.
func TestRecorder_ReDispatchWritesASecondAttemptFileAndLeavesTheFirst(t *testing.T) {
	t.Parallel()

	at := time.Date(2026, 9, 4, 9, 25, 39, 0, time.UTC)
	f := newRecorderFixture(t, LiveTail{Pod: runningPod(),
		Text: v1Line(1, at, `"kind":"log","summary":"first attempt"`) + "\n"})

	first := f.session(t, 1)
	if done, _ := first.poll(context.Background()); done {
		t.Fatal("a Running pod ended the session")
	}

	// The retry's own pod: seq restarts at 1.
	f.src.mu.Lock()
	f.src.pages = []LiveTail{{Pod: runningPod(),
		Text: v1Line(1, at.Add(time.Minute), `"kind":"log","summary":"second attempt"`) + "\n"}}
	f.src.since = nil
	f.src.mu.Unlock()

	second := f.session(t, 2)
	if done, _ := second.poll(context.Background()); done {
		t.Fatal("a Running pod ended the retry's session")
	}

	dir := filepath.Join(gitfs.RunsDir(f.root), "acme", "c1")
	for _, name := range []string{"events.1.ndjson", "events.2.ndjson"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatalf("expected %s: %v", name, err)
		}
	}
	one := f.recorded(t, 1)
	two := f.recorded(t, 2)
	if len(one) != 1 || !strings.Contains(one[0].Detail, "first attempt") {
		t.Fatalf("attempt 1 = %+v, want it untouched by the retry", one)
	}
	if len(two) != 1 || !strings.Contains(two[0].Detail, "second attempt") {
		t.Fatalf("attempt 2 = %+v, want the retry's own feed", two)
	}
	if got := f.store.Attempts("acme", "c1"); len(got) != 2 || got[0] != 1 || got[1] != 2 {
		t.Errorf("attempts = %v, want [1 2] ascending", got)
	}
}

// TestRecorder_DarkZoneIsRecordedOncePerState pins the narration of the stretch
// before the runner speaks. It is RECORDED rather than re-derived per viewer,
// because a viewer that reads only the file would otherwise see nothing at all
// for the slowest part of the flow — and it collapses to one row per state,
// because the same state re-derived every second would otherwise write hundreds.
func TestRecorder_DarkZoneIsRecordedOncePerState(t *testing.T) {
	t.Parallel()

	pulling := LiveTail{Pod: openchoreo.RuntimePod{Found: true, Name: "p1", Phase: "Pending", WaitingReason: "ContainerCreating"}}
	f := newRecorderFixture(t, pulling)
	s := f.session(t, 1)

	for i := 0; i < 3; i++ {
		if done, _ := s.poll(context.Background()); done {
			t.Fatalf("poll %d ended the session", i)
		}
	}
	events := f.recorded(t, 1)
	if len(events) != 1 {
		t.Fatalf("recorded %d dark-zone rows over three identical polls, want 1\n%+v", len(events), events)
	}
	if events[0].Code != gen.RunEventCodeRunnerPullingImage || events[0].Seq != seqBootPulling {
		t.Errorf("dark-zone row = %+v, want the stable pulling marker", events[0])
	}

	// A TRANSITION writes exactly one more row.
	f.src.mu.Lock()
	f.src.pages = []LiveTail{{Pod: runningPod()}}
	f.src.mu.Unlock()
	if done, _ := s.poll(context.Background()); done {
		t.Fatal("a Running pod with no output ended the session")
	}
	events = f.recorded(t, 1)
	if len(events) != 2 || events[1].Code != gen.RunEventCodeRunnerStarting {
		t.Fatalf("after the transition = %+v, want exactly one more row (starting)", events)
	}
}

// TestRecorder_ComponentGoneClosesWithGaps pins the backstop for a Component
// deleted out from under a running recording (retention, or a cancel that
// raced the session): nothing more can ever be read, and what is on disk is by
// definition short of the ending.
func TestRecorder_ComponentGoneClosesWithGaps(t *testing.T) {
	t.Parallel()

	f := newRecorderFixture(t)
	f.src.mu.Lock()
	f.src.err = fmt.Errorf("%w: ca-c1", ErrComponentGone)
	f.src.mu.Unlock()

	s := f.session(t, 1)
	if done, _ := s.poll(context.Background()); !done {
		t.Fatal("a gone Component did not end the session")
	}
	if got := f.store.State("acme", "c1"); got != gen.RunCycleViewRecordingGaps {
		t.Fatalf("state = %q, want gaps", got)
	}
}

// TestRecorder_TransientReadFailureKeepsTheSessionAndTheCursor pins that a
// transport failure is not an answer about the cycle: the session survives and
// the next read asks for the same window, so nothing is skipped.
func TestRecorder_TransientReadFailureKeepsTheSessionAndTheCursor(t *testing.T) {
	t.Parallel()

	f := newRecorderFixture(t)
	f.src.mu.Lock()
	f.src.err = fmt.Errorf("connection refused")
	f.src.mu.Unlock()

	s := f.session(t, 1)
	if done, _ := s.poll(context.Background()); done {
		t.Fatal("a transport failure ended the session")
	}
	if got := f.store.State("acme", "c1"); got != gen.RunCycleViewRecordingRecording {
		t.Fatalf("state = %q, want the recording left open", got)
	}
	if calls := f.src.sinceCalls(); len(calls) != 1 || calls[0] != 0 {
		t.Errorf("sinceSeconds calls = %v, want the cursor to have stayed at 0", calls)
	}
}

// TestRecorder_EnsureSkipsAClosedRecording pins the restart rule: aep-api coming
// back must not re-record a cycle that is already over, which would append a
// second copy of the whole feed to a file a viewer is reading from an offset.
func TestRecorder_EnsureSkipsAClosedRecording(t *testing.T) {
	t.Parallel()

	f := newRecorderFixture(t, LiveTail{Pod: succeededPod()})
	if _, err := f.store.Begin("acme", "c1", 1); err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := f.store.Close("acme", "c1", gen.RunCycleViewRecordingComplete); err != nil {
		t.Fatalf("Close: %v", err)
	}
	f.rec.Ensure(context.Background(), f.cycle)
	// Give a session that should not exist every chance to read.
	select {
	case <-f.src.seen:
		t.Fatal("Ensure started a session for a closed recording")
	case <-time.After(150 * time.Millisecond):
	}
}

// TestRecorder_EnsureIsIdempotentPerAttempt pins that the watcher may hand the
// same cycle over on every tick: a session already running for this attempt is
// left alone rather than replaced, which would restart its cursor.
func TestRecorder_EnsureIsIdempotentPerAttempt(t *testing.T) {
	t.Parallel()

	// A Running pod with no output: the session polls, records the dark zone and
	// then sleeps for an hour, so it is still registered when the second Ensure
	// arrives.
	f := newRecorderFixture(t, LiveTail{Pod: runningPod()})
	f.rec.WithIntervals(time.Hour, time.Hour)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	f.rec.Ensure(ctx, f.cycle)
	select {
	case <-f.src.seen:
	case <-time.After(2 * time.Second):
		t.Fatal("the session never read")
	}
	f.rec.Ensure(ctx, f.cycle)
	f.rec.Ensure(ctx, f.cycle)
	select {
	case <-f.src.seen:
		t.Fatal("a repeated Ensure started a second session for the same attempt")
	case <-time.After(150 * time.Millisecond):
	}
}

// TestRecorder_NilRecorderIsANoOp pins the degraded boot: no workspace volume
// means no recorder, and every entry point has to survive that rather than the
// watcher needing to know.
func TestRecorder_NilRecorderIsANoOp(t *testing.T) {
	t.Parallel()

	if NewCycleRecorder(&fakeRecordSource{}, nil) != nil {
		t.Fatal("a nil store produced a recorder")
	}
	var rec *CycleRecorder
	rec.Ensure(context.Background(), liveCycle("c1"))
	rec.CloseCancelled(context.Background(), liveCycle("c1"))
	rec.retain(map[string]bool{})
}

// TestRecorder_SizeCapNamesItselfAndKeepsRunning pins the cap's trade: the cap
// is off by default and exists for a pathological producer, and a run that
// trips it says so on the feed and CARRIES ON — stopping an agent to protect a
// log would be the wrong way round.
func TestRecorder_SizeCapNamesItselfAndKeepsRunning(t *testing.T) {
	t.Parallel()

	at := time.Date(2026, 9, 4, 9, 25, 39, 0, time.UTC)
	root := t.TempDir()
	store := NewRecordingStore(root, 1) // one byte: anything trips it
	src := &fakeRecordSource{pages: []LiveTail{{Pod: runningPod(),
		Text: v1Line(1, at, `"kind":"log","summary":"one"`) + "\n"}}}
	cyc := liveCycle("c1")
	cyc.Attempts = 1
	rec := NewCycleRecorder(src, store)
	s := newRecordingSession(rec, cyc)
	cur, err := store.Begin("acme", "c1", 1)
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	s.cur = cur

	if done, _ := s.poll(context.Background()); done {
		t.Fatal("the size cap ended the session — the run must keep going")
	}
	if got := store.State("acme", "c1"); got != gen.RunCycleViewRecordingGaps {
		t.Fatalf("state = %q, want gaps", got)
	}
	events, _, err := store.ReadFrom("acme", "c1", 1, 0)
	if err != nil {
		t.Fatalf("ReadFrom: %v", err)
	}
	last := events[len(events)-1]
	if last.Code != gen.RunEventCodeGap || !strings.Contains(last.Detail, "size limit") {
		t.Errorf("last event = %+v, want the size-cap notice", last)
	}
	// Past the cap it stops WRITING, not polling: the pod's terminal phase still
	// has to close the recording.
	before := len(events)
	if done, _ := s.poll(context.Background()); done {
		t.Fatal("the second poll ended the session")
	}
	after, _, _ := store.ReadFrom("acme", "c1", 1, 0)
	if len(after) != before {
		t.Errorf("recorded %d → %d events past the cap, want no more writes", before, len(after))
	}
}

// TestProducerSeq_ReadsBothEnvelopeVersionsAndRejectsProse pins the one input
// dedupe and gap detection depend on. A line with no producer numbering (a
// container's bootstrap output) must be recognised as such, not read as seq 0.
func TestProducerSeq_ReadsBothEnvelopeVersionsAndRejectsProse(t *testing.T) {
	t.Parallel()

	cases := []struct {
		raw     string
		want    int64
		wantSeq bool
	}{
		{`{"schemaVersion":1,"seq":7,"kind":"log","summary":"x"}`, 7, true},
		{`{"v":2,"seq":9,"kind":"notice","agentId":"lead"}`, 9, true},
		{`[oneshot] materialised 3 skill(s)`, 0, false},
		{`{"seq":4,"kind":"log"}`, 0, false},           // neither envelope version
		{`{"schemaVersion":1,"kind":"log"}`, 0, false}, // enveloped but unnumbered
		{`{"broken`, 0, false},
		{``, 0, false},
	}
	for _, tc := range cases {
		seq, ok := producerSeq(tc.raw)
		if seq != tc.want || ok != tc.wantSeq {
			t.Errorf("producerSeq(%q) = (%d,%v), want (%d,%v)", tc.raw, seq, ok, tc.want, tc.wantSeq)
		}
	}
}

// TestRecorder_EveryLineGetsItsOwnSeq is the measured loss, replayed.
//
// The tail of a real 55-minute run (testdata/run-2026-09-08-npm-tail.ndjson):
// six runner events, then five lines of raw container stdout — npm's own update
// notice, written to fd 1 by the `npx` shim AFTER the runner's node process had
// already settled, so no emitter in the runner could ever have numbered them.
// The lift gave all five `seq: 0`, and a console deduping on the key the
// contract names — (cycleId, attempt, seq) — rendered exactly one of them. The
// recording held 1189 events; the screen showed 1185.
//
// It is not really about npm. Everything unstructured takes this path: a stack
// trace, a compiler's error list, a crash tail, the container's bootstrap
// output. A multi-line diagnostic reached the console as its first line, and the
// day that costs somebody a day is the day a run dies and the reason is on lines
// two through eight.
//
// The test drives the whole read path — poll, the terminal FULL RE-READ, then a
// restart re-ingesting the same page off the persisted cursor — because the
// numbering has to be stable across all three or the fix trades a dropped line
// for a duplicated one.
func TestRecorder_EveryLineGetsItsOwnSeq(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile(filepath.Join("testdata", "run-2026-09-08-npm-tail.ndjson"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	lines := strings.Split(strings.TrimRight(string(raw), "\n"), "\n")
	if len(lines) != 11 {
		t.Fatalf("fixture holds %d lines, want 11 (6 runner events + 5 prose)", len(lines))
	}
	wantProse := []string{
		"npm notice",
		"npm notice New major version of npm available! 10.9.8 -> 12.0.2",
		"npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.0.2",
		"npm notice To update run: npm install -g npm@12.0.2",
		"npm notice",
	}

	// The runner's own events land first, while the pod is Running; the prose
	// arrives on the page that also carries the terminal phase, which is exactly
	// how it happened (the five lines are stamped 108ms after `run_settled`).
	live := LiveTail{Pod: runningPod(), Text: strings.Join(lines[:6], "\n") + "\n"}
	final := LiveTail{Pod: succeededPod(), Text: string(raw)}

	f := newRecorderFixture(t, live, final)
	s := f.session(t, 1)
	if done, _ := s.poll(context.Background()); done {
		t.Fatal("a Running pod ended the session")
	}
	if done, _ := s.poll(context.Background()); !done {
		t.Fatal("a terminal pod did not end the session")
	}

	events := f.recorded(t, 1)
	if len(events) != 11 {
		t.Fatalf("recorded %d events, want 11 — the whole tail, deduped once\n%+v", len(events), events)
	}

	// EVERY line has its own identity. `seq` is the console's dedup key, so a
	// repeat here is a row the user never sees.
	seen := map[int64]int{}
	for i, ev := range events {
		if n, dup := seen[ev.Seq]; dup {
			t.Fatalf("event %d (%s %q) reuses seq %d, already taken by event %d — a consumer deduping on (attempt, seq) drops one of them",
				i, ev.Kind, ev.Detail, ev.Seq, n)
		}
		seen[ev.Seq] = i
		if i > 0 && ev.Seq <= events[i-1].Seq {
			t.Fatalf("seq went backwards at %d: %d after %d", i, ev.Seq, events[i-1].Seq)
		}
	}

	// All five prose lines survive, in order and whole.
	var prose []string
	for _, ev := range events {
		if strings.HasPrefix(ev.Detail, "npm notice") {
			if ev.Kind != gen.RunEventKindNotice {
				t.Errorf("raw stdout lifted to %q, want a notice", ev.Kind)
			}
			prose = append(prose, ev.Detail)
		}
	}
	if len(prose) != len(wantProse) {
		t.Fatalf("recorded %d prose lines, want %d — this is the loss\n%v", len(prose), len(wantProse), prose)
	}
	for i := range wantProse {
		if prose[i] != wantProse[i] {
			t.Errorf("prose line %d = %q, want %q", i, prose[i], wantProse[i])
		}
	}

	// The seq is the event's POSITION IN THE RECORDING, which is what the
	// contract says it is: dense from 1, one per line, prose included. (This
	// fixture is a TAIL, so position 1 is the producer's 1179. A recording that
	// watched the run from its first line — the ordinary case — numbers every
	// runner event exactly as the runner did, right up to the first seq-less
	// line, which keeps a recording diffable against the pod's own log.)
	for i, ev := range events {
		if ev.Seq != int64(i+1) {
			t.Errorf("event %d is at seq %d, want %d — seq is the position in the attempt", i, ev.Seq, i+1)
		}
	}

	// F13: state.json must not disagree with itself. It used to report 1189
	// events under a cursor that had only ever seen 1184 of them, because the
	// seq-less lines advanced nothing.
	meta := f.meta(t)
	if meta.Events != int64(len(events)) {
		t.Errorf("state.json events = %d, want %d", meta.Events, len(events))
	}
	if meta.Cursor.LastSeq != events[len(events)-1].Seq {
		t.Errorf("state.json cursor.lastSeq = %d, want %d — the cursor must account for the seq-less lines too",
			meta.Cursor.LastSeq, events[len(events)-1].Seq)
	}
	if meta.Cursor.ProseTS.IsZero() {
		t.Error("state.json cursor.proseTs is unset; a restart would re-record the prose")
	}

	// A RESTART re-reads the whole log off the persisted cursor. Nothing may be
	// written twice and nothing renumbered — the recorder's numbering is stable
	// only because ProducerSeq and ProseTS both survive the restart.
	restarted := f.session(t, 1)
	restarted.ingest(context.Background(), final)
	after := f.recorded(t, 1)
	if len(after) != len(events) {
		t.Fatalf("a restart re-recorded the page: %d events, want %d", len(after), len(events))
	}
	for i := range after {
		if after[i].Seq != events[i].Seq || after[i].Detail != events[i].Detail {
			t.Errorf("event %d changed across the restart: %+v, want %+v", i, after[i], events[i])
		}
	}
}
