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
	"errors"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/contracts/activityvocab"
)

// fakeRepo is a DB-free Repository double. It guards its state with a mutex
// because the stream tests drive it from two goroutines at once (the test
// goroutine inserting/notifying, the OpenStream loop re-reading on tail).
type fakeRepo struct {
	mu       sync.Mutex
	inserted []*ActivityEvent
	insErr   error
	dup      bool // when true, Insert reports a no-op (inserted=false)

	gotLimit int // limit last passed to ListByProject
}

func (f *fakeRepo) Insert(_ context.Context, row *ActivityEvent) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.insErr != nil {
		return false, f.insErr
	}
	if f.dup {
		return false, nil
	}
	f.inserted = append(f.inserted, row)
	return true, nil
}

// ListByProject returns the inserted rows newest-first (matching the real
// repository's ordering), so stream tests can exercise replay without a DB.
// gotLimit is still recorded for the existing clamp assertions.
func (f *fakeRepo) ListByProject(_ context.Context, _ string, _ string, limit int, _ time.Time, _ string) ([]ActivityEvent, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.gotLimit = limit
	if len(f.inserted) == 0 {
		return nil, nil
	}
	rows := make([]ActivityEvent, len(f.inserted))
	for i, r := range f.inserted {
		rows[i] = *r
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].OccurredAt.After(rows[j].OccurredAt) })
	return rows, nil
}

// insert is a test helper for goroutine-safe appends outside of Insert
// (stream tests seed rows directly, then notify the hub themselves).
func (f *fakeRepo) insert(row *ActivityEvent) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.inserted = append(f.inserted, row)
}

func TestService_Record_swallowsErrorAndSkipsNotifyOnFailure(t *testing.T) {
	repo := &fakeRepo{insErr: errors.New("db down")}
	hub := NewActivityHub()
	ch, cancel := hub.Subscribe("org1", "proj1")
	defer cancel()
	svc := NewActivityService(repo, hub)

	// Must not panic / must not propagate the error (Record returns nothing).
	svc.Record(context.Background(), ActivityInput{OrgID: "org1", ProjectID: "proj1", Type: activityvocab.TypePlanDerived, ActorName: "Plan agent", OccurredAt: time.Now()})

	select {
	case <-ch:
		t.Fatal("failed insert must not notify the hub")
	default:
	}
}

func TestService_Record_notifiesOnlyOnRealInsert(t *testing.T) {
	repo := &fakeRepo{}
	hub := NewActivityHub()
	ch, cancel := hub.Subscribe("org1", "proj1")
	defer cancel()
	NewActivityService(repo, hub).Record(context.Background(), ActivityInput{OrgID: "org1", ProjectID: "proj1", Type: activityvocab.TypeTaskStarted, ActorName: "Build agent", OccurredAt: time.Now()})
	select {
	case <-ch:
	default:
		t.Fatal("real insert should have notified")
	}

	dupRepo := &fakeRepo{dup: true}
	hub2 := NewActivityHub()
	ch2, cancel2 := hub2.Subscribe("org1", "proj1")
	defer cancel2()
	NewActivityService(dupRepo, hub2).Record(context.Background(), ActivityInput{OrgID: "org1", ProjectID: "proj1", Type: activityvocab.TypeTaskStarted, ActorName: "Build agent", OccurredAt: time.Now()})
	select {
	case <-ch2:
		t.Fatal("duplicate no-op must not notify")
	default:
	}
}

func TestService_List_clampsLimit(t *testing.T) {
	repo := &fakeRepo{}
	svc := NewActivityService(repo, NewActivityHub())

	if _, err := svc.List(context.Background(), "org1", "proj1", 0, time.Time{}, ""); err != nil {
		t.Fatalf("List(0): %v", err)
	}
	if repo.gotLimit != defaultLimit {
		t.Fatalf("List(0): repo got limit %d, want defaultLimit %d", repo.gotLimit, defaultLimit)
	}

	if _, err := svc.List(context.Background(), "org1", "proj1", 10_000, time.Time{}, ""); err != nil {
		t.Fatalf("List(10000): %v", err)
	}
	if repo.gotLimit != maxLimit {
		t.Fatalf("List(10000): repo got limit %d, want maxLimit %d", repo.gotLimit, maxLimit)
	}

	if _, err := svc.List(context.Background(), "org1", "proj1", 25, time.Time{}, ""); err != nil {
		t.Fatalf("List(25): %v", err)
	}
	if repo.gotLimit != 25 {
		t.Fatalf("List(25): repo got limit %d, want 25 (in-range passthrough)", repo.gotLimit)
	}
}
