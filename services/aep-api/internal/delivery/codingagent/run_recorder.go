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

// run_recorder.go — the platform reads a cycle's feed ONCE, for everybody.
//
// Before this, the pod's log was tailed PER VIEWER: every SSE connection polled
// the pod on its own 2s tick, kept the newest 64KiB, and wrote nothing. Two
// viewers cost two reads; zero viewers cost zero, which is why a run watched by
// nobody left no trace of itself at all. The recorder inverts that: ONE
// server-side reader per cycle, running whether or not anybody is looking,
// writing an append-only file that every viewer then reads (run_recording.go).
//
// Cadence is deliberately asymmetric — 1s while the pod is Running, the cycle
// watcher's 30s otherwise. The fast tick is what makes a live feed feel live;
// the slow one is what keeps the platform from hammering a log that is not
// growing (a scheduling pod, a finished one whose Component is retained).
//
// It ends on a TERMINAL pod phase plus ONE FINAL FULL READ. The final read is
// not belt-and-braces: a pod that exits between two polls has already written
// its last words — the runner's terminal `result` line among them — and the
// OpenChoreo log API still serves them for as long as the Component exists.
// Without that read the recording would stop a poll interval short of the run's
// own ending, every time.
//
// The runner makes no network call for any of this. Its stdout is still the one
// transport, which is what keeps a runner that cannot reach the platform from
// being a runner whose work is invisible.
//
// A `run_settled` DOES NOT CLOSE THE FEED — the pod's terminal phase does. The
// runner's last event is a statement about its own session, not about the
// container's stdout, and the container keeps writing after it: a package
// manager's exit notice, a shutdown hook, a crash tail from whatever was still
// running. Those lines are recorded like any other. The alternative — stop at
// `run_settled` — throws away the output most likely to explain a run that ended
// badly, which is the one thing this recording exists to hold on to. What it
// costs is that a reader cannot assume `run_settled` is the last line; it is the
// line that says how the run ENDED, and `state.json`'s `closed` is the one that
// says nothing more is coming.

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/gen"
)

// Recorder cadences. livePoll is what a viewer experiences as latency; idlePoll
// matches the cycle watcher's own tick, because a pod that is not Running has
// nothing new to say between two of those.
const (
	defaultLivePoll = 1 * time.Second
	defaultIdlePoll = 30 * time.Second
	// recordReadOverlap is how far BACK of its own cursor each incremental read
	// asks. The OpenChoreo log API's cursor is a coarse `sinceSeconds`, so an
	// exact cursor would race the clock and drop whatever landed in the rounding.
	// Overlap costs a re-read of a second or two of log, which dedupe throws
	// away; the alternative costs events, which nothing can recover.
	recordReadOverlap = 3 * time.Second
)

// CycleRecorder records dispatched cycles' feeds. Its lifecycle is the cycle
// watcher's: the watcher discovers dispatched cycles on its own tick and calls
// Ensure for each, and each cycle's session then paces itself.
//
// A nil recorder is a boot with no workspace volume (the store is nil). Every
// method is then a no-op and every reader reports `none`, which is the honest
// answer: the platform has no record of that cycle's feed.
type CycleRecorder struct {
	src   RecordingLogSource
	store *RecordingStore
	// archive is called ONLY to backfill a detected gap. It is emphatically not
	// the ordinary post-mortem source any more — that is the recording — and the
	// 200-event window that used to be a run's whole history is gone with it.
	archive ArchiveLogSource

	livePoll time.Duration
	idlePoll time.Duration

	mu       sync.Mutex
	sessions map[string]*recordingSession
}

// NewCycleRecorder wires the recorder. A nil store (no workspace volume)
// returns nil, so the composition root can hand the result straight on.
func NewCycleRecorder(src RecordingLogSource, store *RecordingStore) *CycleRecorder {
	if src == nil || store == nil {
		return nil
	}
	return &CycleRecorder{
		src:      src,
		store:    store,
		livePoll: defaultLivePoll,
		idlePoll: defaultIdlePoll,
		sessions: map[string]*recordingSession{},
	}
}

// WithArchive attaches the gap-backfill source. Optional: without it a detected
// gap is simply named on the feed. Returns the receiver.
func (r *CycleRecorder) WithArchive(a ArchiveLogSource) *CycleRecorder {
	if r != nil {
		r.archive = a
	}
	return r
}

// WithIntervals overrides the two cadences. Zero keeps the defaults. Held as
// fields purely so a test drives the loop in milliseconds. Returns the receiver.
func (r *CycleRecorder) WithIntervals(live, idle time.Duration) *CycleRecorder {
	if r == nil {
		return r
	}
	if live > 0 {
		r.livePoll = live
	}
	if idle > 0 {
		r.idlePoll = idle
	}
	return r
}

// Ensure starts (or replaces) the recording session for a dispatched cycle. It
// is safe to call on every watcher tick: a session already running for this
// attempt is left alone, and a cycle whose recording is already closed is not
// restarted.
//
// ctx must be the watcher's own long-lived context — the session outlives the
// tick that started it and stops when the process does. That is why this takes
// the watcher's ctx rather than deriving one: a session on a per-tick context
// would be cancelled a moment after it started and the recording would consist
// of one poll.
func (r *CycleRecorder) Ensure(ctx context.Context, cycle *delivery.RunCycle) {
	if r == nil || cycle == nil || cycle.JobRef == "" || cycle.Attempts <= 0 {
		return
	}
	if r.store.Finished(cycle.OrgID, cycle.ID, cycle.Attempts) {
		return
	}

	r.mu.Lock()
	if live := r.sessions[cycle.ID]; live != nil {
		if live.attempt == cycle.Attempts {
			r.mu.Unlock()
			return
		}
		// A re-dispatch: a NEW pod whose seqs restart at 1. The old session is
		// cancelled and the new one writes its own attempt file — the previous
		// one is left exactly as it is, because a retry never rewrites the history
		// of the attempt it is retrying.
		live.stop()
	}
	s := newRecordingSession(r, cycle)
	// The cancel funnel is installed BEFORE the goroutine starts, so a stop that
	// races the start (a re-dispatch landing on the very next tick) actually
	// stops something instead of arming a switch nobody is holding.
	sctx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	r.sessions[cycle.ID] = s
	r.mu.Unlock()

	cur, err := r.store.Begin(cycle.OrgID, cycle.ID, cycle.Attempts)
	if err != nil {
		slog.WarnContext(ctx, "codingagent.CycleRecorder: could not open a recording; this cycle's feed will not be served",
			"cycle", cycle.ID, "attempt", cycle.Attempts, "error", err)
		s.stop()
		r.forget(cycle.ID, s)
		return
	}
	s.cur = cur
	go s.run(sctx)
}

// retain drops every session whose cycle has left the watcher's window, so the
// map cannot grow with the table. The recording itself is left exactly as it is
// — an open one stays `recording`, and a restart that sees the cycle again
// resumes it from the persisted cursor.
func (r *CycleRecorder) retain(live map[string]bool) {
	if r == nil {
		return
	}
	r.mu.Lock()
	var stale []*recordingSession
	for id, s := range r.sessions {
		if !live[id] {
			stale = append(stale, s)
			delete(r.sessions, id)
		}
	}
	r.mu.Unlock()
	for _, s := range stale {
		s.stop()
	}
}

// forget removes a session only if it is still the registered one, so a
// finishing session cannot evict its own replacement after a re-dispatch.
func (r *CycleRecorder) forget(cycleID string, s *recordingSession) {
	r.mu.Lock()
	if r.sessions[cycleID] == s {
		delete(r.sessions, cycleID)
	}
	r.mu.Unlock()
}

// CloseCancelled ends a cancelled cycle's recording.
//
// Cancel deletes the Component immediately — that is what actually stops the
// pod and frees the org's billing concurrency slot — and from that instant the
// pod's log is unreadable, so whatever fell between the last poll and the
// delete is gone for good. The recording therefore closes with what it has,
// plus a runner-less `run_settled {outcome: cancelled}` so a reader can see the
// run ended rather than merely stopped talking, and its state is `gaps`: the
// platform KNOWS the tail is missing and says so instead of presenting a
// truncated feed as the whole of it.
//
// `cancelled` is deliberately not `failure`. The work was taken away; nothing
// went wrong.
func (r *CycleRecorder) CloseCancelled(ctx context.Context, cycle *delivery.RunCycle) {
	if r == nil || cycle == nil || cycle.JobRef == "" || cycle.Attempts <= 0 {
		return
	}
	r.mu.Lock()
	s := r.sessions[cycle.ID]
	delete(r.sessions, cycle.ID)
	r.mu.Unlock()
	if s != nil {
		s.stop()
	}
	if !r.store.HasRecording(cycle.OrgID, cycle.ID) {
		return
	}
	cur := r.store.Cursor(cycle.OrgID, cycle.ID)
	cur.LastSeq++
	settled := gen.RunEvent{
		V:       gen.RunEventV2,
		Seq:     cur.LastSeq,
		TS:      time.Now().UTC(),
		Kind:    gen.RunEventKindRunSettled,
		AgentID: leadAgentID,
		Outcome: gen.RunEventOutcomeCancelled,
	}
	if _, _, err := r.store.Append(cycle.OrgID, cycle.ID, cycle.Attempts, []gen.RunEvent{settled}, cur); err != nil {
		slog.WarnContext(ctx, "codingagent.CycleRecorder: could not close a cancelled recording",
			"cycle", cycle.ID, "error", err)
	}
	if err := r.store.Close(cycle.OrgID, cycle.ID, gen.RunCycleViewRecordingGaps); err != nil {
		slog.WarnContext(ctx, "codingagent.CycleRecorder: could not mark a cancelled recording",
			"cycle", cycle.ID, "error", err)
	}
}

// recordingSession is ONE attempt's recording: the cursor into the producer's
// stream, the lifter that turns its lines into v2 events, and the loop that
// paces the reads.
//
// The lifter is per SESSION and not per page, which is the one place the
// recorder is strictly better informed than a viewer ever was: a live tail is a
// sliding window, so a viewer re-announces every subagent it can see on every
// attach, while the recorder watched them all start and announces each exactly
// once.
type recordingSession struct {
	rec     *CycleRecorder
	cycle   delivery.RunCycle // a copy: the watcher re-reads the row every tick
	attempt int

	cur  recordCursor
	lift *lifter

	// lastRead is when the previous successful read returned, and is what the
	// next read's sinceSeconds is measured from. Zero means "never read", which
	// asks for the whole log.
	lastRead time.Time
	// gapped latches the moment the feed is known to have lost events.
	gapped bool
	// capped latches the per-cycle size cap. Past it the session keeps polling
	// (so the pod's terminal phase still closes the recording) and stops writing.
	capped bool

	cancel context.CancelFunc
	once   sync.Once
}

func newRecordingSession(r *CycleRecorder, cycle *delivery.RunCycle) *recordingSession {
	return &recordingSession{
		rec:     r,
		cycle:   *cycle,
		attempt: cycle.Attempts,
		lift:    newLifter(),
	}
}

// stop cancels the session's loop. Idempotent.
func (s *recordingSession) stop() {
	s.once.Do(func() {
		if s.cancel != nil {
			s.cancel()
		}
	})
}

// run is the session's loop: poll, pace, repeat, until the pod settles or the
// process stops. A process stop leaves the recording OPEN (`recording`), which
// is what lets a restart re-Begin the same attempt and carry on from the
// persisted cursor rather than re-writing what it already has.
func (s *recordingSession) run(ctx context.Context) {
	defer s.stop()
	defer s.rec.forget(s.cycle.ID, s)

	for {
		if ctx.Err() != nil {
			return
		}
		done, phase := s.poll(ctx)
		if done {
			return
		}
		wait := s.rec.idlePoll
		if strings.EqualFold(phase, "Running") {
			wait = s.rec.livePoll
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

// poll performs one read and reports whether the session is over.
func (s *recordingSession) poll(ctx context.Context) (done bool, phase string) {
	tail, err := s.rec.src.ReadSince(ctx, s.cycle.OrgID, s.cycle.ProjectID, s.cycle.JobRef, s.sinceSeconds())
	if err != nil {
		if errors.Is(err, ErrComponentGone) {
			// The Component was deleted out from under a running recording — a
			// cancel that raced us, or retention. Nothing more can ever be read, and
			// what we have is by definition short of the ending.
			s.close(ctx, gen.RunCycleViewRecordingGaps)
			return true, ""
		}
		// A transport failure is not an answer about the cycle. Keep the session
		// and try again on the next tick; the cursor did not move, so the retry
		// asks for the same window.
		slog.WarnContext(ctx, "codingagent.CycleRecorder: pod log read failed (transient)",
			"cycle", s.cycle.ID, "attempt", s.attempt, "error", err)
		return false, ""
	}
	s.lastRead = time.Now()
	s.ingest(ctx, tail)

	if !terminalPod(tail.Pod) {
		return false, tail.Pod.Phase
	}
	// ONE final FULL read. A pod that exited between two polls has already
	// written its last words and the log API still serves them while the
	// Component exists; dedupe by seq makes re-reading the whole log free of
	// duplicates, so the cheapest correct thing is to ask for all of it.
	if final, ferr := s.rec.src.ReadSince(ctx, s.cycle.OrgID, s.cycle.ProjectID, s.cycle.JobRef, 0); ferr == nil {
		s.ingest(ctx, final)
	} else {
		slog.WarnContext(ctx, "codingagent.CycleRecorder: final log read failed; the recording may be short of the run's ending",
			"cycle", s.cycle.ID, "attempt", s.attempt, "error", ferr)
		s.gapped = true
	}
	state := gen.RunCycleViewRecordingComplete
	if s.gapped {
		state = gen.RunCycleViewRecordingGaps
	}
	s.close(ctx, state)
	return true, tail.Pod.Phase
}

// sinceSeconds is the time cursor for the next read: everything since the last
// successful one, widened by recordReadOverlap. Zero — the whole log — until
// the first read lands.
func (s *recordingSession) sinceSeconds() int64 {
	if s.lastRead.IsZero() {
		return 0
	}
	since := time.Since(s.lastRead) + recordReadOverlap
	secs := int64(since/time.Second) + 1
	if secs < 1 {
		secs = 1
	}
	return secs
}

// ingest turns one raw page into events and appends whatever is new.
func (s *recordingSession) ingest(ctx context.Context, tail LiveTail) {
	if s.capped {
		return
	}
	events := s.consume(ctx, tail.Text)
	if len(events) == 0 {
		// Nothing the producer said. While NOTHING has ever been recorded and the
		// pod has not settled, the pod's own state is the only report there is —
		// the dark zone (scheduling, image pull, container boot) that used to show
		// a dead "waiting…" for the slowest part of the flow. It is recorded, not
		// re-derived per viewer, because a viewer that reads only the recording
		// would otherwise see nothing at all until the runner's first line.
		if s.cur.ProducerSeq == 0 && s.cur.ProseTS.IsZero() && !terminalPod(tail.Pod) {
			boot := bootstrapRunEvent(tail.Pod.Found, tail.Pod.Phase, tail.Pod.WaitingReason, tail.Pod.Message)
			if boot.Seq == s.cur.BootSeq {
				return // the same state, re-derived: one row, not one per second
			}
			s.cur.BootSeq = boot.Seq
			events = []gen.RunEvent{boot}
		} else {
			return
		}
	}
	_, dropped, err := s.rec.store.Append(s.cycle.OrgID, s.cycle.ID, s.attempt, events, s.cur)
	if err != nil {
		slog.WarnContext(ctx, "codingagent.CycleRecorder: append to recording failed",
			"cycle", s.cycle.ID, "attempt", s.attempt, "error", err)
		s.markGaps(ctx)
		return
	}
	if dropped > 0 {
		s.markGaps(ctx)
	}
	if s.rec.store.OverCap(s.cycle.OrgID, s.cycle.ID) {
		// The cap is off by default and exists for a pathological producer. A run
		// that trips it keeps RUNNING — stopping an agent to protect a log would be
		// the wrong trade — and says on the feed that the rest is not recorded.
		s.capped = true
		notice := platformNotice(s.nextSeq(), gen.RunEventLevelWarn,
			"This cycle's output passed the recording size limit; the rest of the run was not recorded.")
		notice.Code = gen.RunEventCodeGap
		_, _, _ = s.rec.store.Append(s.cycle.OrgID, s.cycle.ID, s.attempt, []gen.RunEvent{notice}, s.cur)
		s.markGaps(ctx)
	}
}

// consume turns one raw pod-log page into the v2 events this session has not
// recorded yet, splicing in a backfill (or a `notice`) wherever the producer's
// own numbering shows events missing.
func (s *recordingSession) consume(ctx context.Context, text string) []gen.RunEvent {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	// One choke point, exactly as the viewer-side reader has: redacting the raw
	// page once covers wrapped prose and structured envelope fields alike. It
	// matters MORE here — a viewer's page is thrown away, and this one is written
	// to a file that outlives the run. See redact.go.
	text = redactSecrets(text)
	text = dropTruncatedTail(text)

	out := make([]gen.RunEvent, 0, 64)
	backfilled := false
	for _, ln := range splitPage(text) {
		if !ln.hasSeq {
			// A seq-less line (container bootstrap output, a stray library write, a
			// subprocess writing straight to fd 1, a crash tail). The kubelet's own
			// clock is its only cursor — see recordCursor.ProseTS — and its position
			// in this file is its only sequence, which s.number stamps.
			ts := parseEventTime(ln.ts)
			if ts.IsZero() || !ts.After(s.cur.ProseTS) {
				continue
			}
			s.cur.ProseTS = ts
			out = append(out, s.number(s.lift.line(ln.msg, ln.ts))...)
			continue
		}
		if ln.seq <= s.cur.ProducerSeq {
			continue // already recorded; the read window deliberately overlaps
		}
		if s.cur.ProducerSeq > 0 && ln.seq > s.cur.ProducerSeq+1 {
			recovered, missing := s.repairGap(ctx, s.cur.ProducerSeq, ln.seq, &backfilled)
			out = append(out, s.number(recovered)...)
			if missing > 0 {
				out = append(out, gapNotice(s.nextSeq(), missing))
				s.markGaps(ctx)
			}
		}
		s.cur.ProducerSeq = ln.seq
		out = append(out, s.number(s.lift.line(ln.msg, ln.ts))...)
	}
	return out
}

// repairGap asks the observability plane for the events the pod read skipped
// over, and reports how many are still missing after it answers.
//
// The archive is the ONLY caller-visible use left for the observer on this
// path. It used to be the ordinary post-mortem source — a finished run's whole
// history was its newest 200 events — and the recording replaced that. What it
// is good for is precisely this: it indexed the same pod's output all along, so
// a burst the platform's own read missed may still be there.
//
// At most one archive call per page: a page with several gaps is a page whose
// source is struggling, and hammering the observer would not help it.
func (s *recordingSession) repairGap(ctx context.Context, after, before int64, backfilled *bool) ([]gen.RunEvent, int64) {
	missing := before - after - 1
	if s.rec.archive == nil || *backfilled {
		return nil, missing
	}
	*backfilled = true
	text, err := s.rec.archive.CycleArchive(ctx, ArchiveScope{
		OrgName:       s.cycle.OrgID,
		ProjectName:   s.cycle.ProjectID,
		ComponentName: s.cycle.JobRef,
		From:          s.cycle.CreatedAt.UTC().Add(-5 * time.Minute),
		To:            time.Now().UTC(),
	})
	if err != nil || strings.TrimSpace(text) == "" {
		return nil, missing
	}
	text = redactSecrets(text)
	out := make([]gen.RunEvent, 0, missing)
	for _, ln := range splitPage(text) {
		if !ln.hasSeq || ln.seq <= after || ln.seq >= before {
			continue
		}
		out = append(out, s.lift.line(ln.msg, ln.ts)...)
		missing--
		after = ln.seq
	}
	if missing < 0 {
		missing = 0
	}
	slog.InfoContext(ctx, "codingagent.CycleRecorder: backfilled a feed gap from the archive",
		"cycle", s.cycle.ID, "attempt", s.attempt, "recovered", len(out), "stillMissing", missing)
	return out, missing
}

// number stamps the recording's own seq onto events the lift produced, in the
// order they will be written, and reports the same slice.
//
// THE RECORDER IS THE FEED'S NUMBERING AUTHORITY, and it has to be. `seq` is
// what the contract tells a consumer to dedupe and order on, and the producer's
// numbering cannot serve: a third of the lines on this stream carry no envelope
// at all (container bootstrap, a stray library write, a subprocess writing
// straight to fd 1, a crash tail), so they used to be numbered 0 — every one of
// them, which made them one event to anybody deduping by seq. A measured run
// ended with five `npm notice` lines and a console that showed one of them.
//
// The number is this event's POSITION IN THE FILE, which is exactly what the
// contract says seq is, and it is STABLE ACROSS RE-READS because the recorder
// never lifts a line twice: a line with an envelope is skipped once its seq is
// at or below cursor.ProducerSeq, and a seq-less one once its pod clock is at or
// below cursor.ProseTS. Both cursors are persisted beside the events, so a
// restart — and the final full re-read every terminal pod gets — resumes the
// numbering rather than restarting it.
//
// Events carrying a NEGATIVE seq are left alone. Those are the platform's own
// dark-zone markers (agent_progress.go's seqBoot* space): they are re-derived on
// every poll and their whole purpose is that the same state collapses to one row
// under the client's dedup, which only a fixed seq achieves.
func (s *recordingSession) number(events []gen.RunEvent) []gen.RunEvent {
	for i := range events {
		if events[i].Seq < 0 {
			continue
		}
		events[i].Seq = s.nextSeq()
	}
	return events
}

// nextSeq allocates the next free position in this attempt's feed. It is the
// only writer of cursor.LastSeq, so the cursor persisted in state.json always
// accounts for every event the file holds — including the seq-less ones, which
// it silently did not before.
func (s *recordingSession) nextSeq() int64 {
	s.cur.LastSeq++
	return s.cur.LastSeq
}

// markGaps latches the cycle's recording as known-incomplete. It does NOT close
// it: the run is still going and the rest of the feed is still worth recording.
func (s *recordingSession) markGaps(ctx context.Context) {
	if s.gapped {
		return
	}
	s.gapped = true
	if err := s.rec.store.Mark(s.cycle.OrgID, s.cycle.ID, gen.RunCycleViewRecordingGaps); err != nil {
		slog.WarnContext(ctx, "codingagent.CycleRecorder: mark recording gaps failed", "cycle", s.cycle.ID, "error", err)
	}
}

// close finalises the recording and drops the session.
func (s *recordingSession) close(ctx context.Context, state gen.RunCycleViewRecording) {
	if err := s.rec.store.Close(s.cycle.OrgID, s.cycle.ID, state); err != nil {
		slog.WarnContext(ctx, "codingagent.CycleRecorder: close recording failed", "cycle", s.cycle.ID, "error", err)
		return
	}
	slog.InfoContext(ctx, "codingagent.CycleRecorder: recording closed",
		"cycle", s.cycle.ID, "attempt", s.attempt, "state", string(state))
}

// gapNotice is the "events are missing here" row, written INTO the recording at
// the point they went missing rather than reported once at the end. A reader
// scrolling a feed has to be able to see WHERE the hole is; a flag on the
// response can only say that there is one somewhere.
func gapNotice(seq, missing int64) gen.RunEvent {
	ev := platformNotice(seq, gen.RunEventLevelWarn,
		fmt.Sprintf("… %d event(s) of this run were not captured and could not be recovered", missing))
	ev.Code = gen.RunEventCodeGap
	return ev
}

// pageLine is one raw log line split into what the recorder decides on: the
// kubelet timestamp prefix, the producer's own line, and the producer's SEQ
// where the envelope carries one.
type pageLine struct {
	ts     string
	msg    string
	seq    int64
	hasSeq bool
}

// splitPage splits a raw pod-log page into lines. A line past the scanner's cap
// stops the scan and the rest of the page is left for the next read — the read
// window overlaps and the cursor did not move, so nothing is lost by stopping.
func splitPage(text string) []pageLine {
	out := make([]pageLine, 0, 256)
	scanner := bufio.NewScanner(strings.NewReader(text))
	scanner.Buffer(make([]byte, 0, 4096), recordingLineCap)
	for scanner.Scan() {
		ts, msg := splitTimestampPrefix(scanner.Text())
		seq, ok := producerSeq(msg)
		out = append(out, pageLine{ts: ts, msg: msg, seq: seq, hasSeq: ok})
	}
	if err := scanner.Err(); err != nil {
		slog.Warn("codingagent.CycleRecorder: log scan stopped early; the rest of this page waits for the next read", "error", err)
	}
	return out
}

// producerSeq reads the SEQ off a runner line without committing to an envelope
// version — `{"v":2,…}` and `{"schemaVersion":1,…}` both number their events
// the same way, one up per line.
//
// The recorder deliberately dedupes and gap-detects in the PRODUCER's numbering
// and not in the v2 one it writes. The lift doubles a v1 seq (2·s, with 2·s−1
// reserved for a synthesised `agent_started`), so a detector reading v2 seqs
// would report a missing event between every single pair of lines.
func producerSeq(raw string) (int64, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed[0] != '{' {
		return 0, false
	}
	var probe struct {
		V             int   `json:"v"`
		SchemaVersion int   `json:"schemaVersion"`
		Seq           int64 `json:"seq"`
	}
	if err := json.Unmarshal([]byte(trimmed), &probe); err != nil {
		return 0, false
	}
	if probe.Seq <= 0 {
		return 0, false
	}
	if probe.V != int(gen.RunEventV2) && probe.SchemaVersion != progressSchemaVersion {
		return 0, false
	}
	return probe.Seq, true
}
