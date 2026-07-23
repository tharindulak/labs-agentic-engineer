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

package projects

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/contracts/activityvocab"
)

// syncBuffer is a goroutine-safe io.Writer + String(), standing in for the
// http.ResponseWriter the real handler passes to OpenStream: the OpenStream
// goroutine writes frames while the test goroutine polls the accumulated
// output, so a bare strings.Builder would race.
type syncBuffer struct {
	mu  sync.Mutex
	buf strings.Builder
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// waitUntil polls cond in small steps up to a ~1s bound, so the test isn't
// racy against the goroutine running the stream loop but also isn't a fixed
// sleep (fails fast once cond is true).
func waitUntil(cond func() bool) bool {
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(2 * time.Millisecond)
	}
	return cond()
}

func TestOpenStream_replaysExistingEvents(t *testing.T) {
	repo := &fakeRepo{}
	repo.insert(&ActivityEvent{
		ID: "a", Type: activityvocab.TypeSpecPublished, ActorKind: "user",
		ActorName: "You", OccurredAt: time.Now().UTC(),
	})
	svc := NewActivityService(repo, NewActivityHub())

	var sb syncBuffer
	ctx, cancel := context.WithCancel(context.Background())
	run := svc.OpenStream(ctx, "org1", "proj1", "")
	done := make(chan struct{})
	go func() { run(&sb, func() {}); close(done) }()
	// let the initial replay run, then disconnect
	if !waitUntil(func() bool { return strings.Contains(sb.String(), `"id":"a"`) }) {
		t.Fatalf("replay frame missing: %q", sb.String())
	}
	cancel()
	<-done
}

func TestOpenStream_tailsHubForNewEvents(t *testing.T) {
	repo := &fakeRepo{}
	hub := NewActivityHub()
	svc := NewActivityService(repo, hub)

	var sb syncBuffer
	ctx, cancel := context.WithCancel(context.Background())
	run := svc.OpenStream(ctx, "org1", "proj1", "")
	done := make(chan struct{})
	go func() { run(&sb, func() {}); close(done) }()

	// Nothing to replay at start (repo is empty). Seed a row, matching what
	// ActivityService.Record would insert. The loop's hub.Subscribe happens inside
	// the goroutine above, so there's no signal for "subscribed yet" — notify
	// on every poll tick instead of once, so a Notify racing the initial
	// Subscribe registration (and landing before it) isn't lost: a later
	// retick after subscription succeeds always wakes the tail loop.
	repo.insert(&ActivityEvent{
		ID: "b", Type: activityvocab.TypeTaskStarted, ActorKind: "agent",
		ActorName: "Build agent", OccurredAt: time.Now().UTC(),
	})
	if !waitUntil(func() bool {
		hub.Notify("org1", "proj1")
		return strings.Contains(sb.String(), `"id":"b"`)
	}) {
		t.Fatalf("tailed frame missing: %q", sb.String())
	}
	cancel()
	<-done
}

func TestParseCursor(t *testing.T) {
	if tm, id := parseCursor(""); !tm.IsZero() || id != "" {
		t.Fatalf("empty cursor should be zero: %v %q", tm, id)
	}
	if tm, id := parseCursor("garbage"); !tm.IsZero() || id != "" {
		t.Fatalf("cursor without a separator should be tolerated (zero): %v %q", tm, id)
	}
	if tm, id := parseCursor("not-a-time|xyz"); !tm.IsZero() || id != "" {
		t.Fatalf("cursor with an unparsable time should be tolerated (zero): %v %q", tm, id)
	}
	want := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	cursor := want.Format(time.RFC3339Nano) + "|abc"
	if tm, id := parseCursor(cursor); !tm.Equal(want) || id != "abc" {
		t.Fatalf("parseCursor(%q) = %v, %q; want %v, %q", cursor, tm, id, want, "abc")
	}
}
