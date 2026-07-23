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
	"encoding/json"
	"fmt"
	"io"
	"time"
)

const keepAlive = 20 * time.Second

// OpenStream returns a connection loop (for sseStream): replay the recent feed
// oldest-first from the resume cursor, then tail the hub — re-reading and
// emitting events newer than the last one sent — until ctx is canceled (client
// disconnect). Reconnect-safe: the client dedups by id.
func (s *ActivityService) OpenStream(ctx context.Context, orgID, projectID, lastEventID string) func(w io.Writer, flush func()) {
	return func(w io.Writer, flush func()) {
		ch, cancel := s.Subscribe(orgID, projectID)
		defer cancel()

		lastTime, lastID := parseCursor(lastEventID)

		emitNewer := func() {
			rows, err := s.repo.ListByProject(ctx, orgID, projectID, defaultLimit, time.Time{}, "")
			if err != nil {
				return
			}
			for i := len(rows) - 1; i >= 0; i-- { // newest-first → emit oldest-first
				r := rows[i]
				if !newer(r, lastTime, lastID) {
					continue
				}
				writeFrame(w, r)
				lastTime, lastID = r.OccurredAt, r.ID
			}
			flush()
		}

		emitNewer() // initial replay
		ticker := time.NewTicker(keepAlive)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ch:
				emitNewer()
			case <-ticker.C:
				_, _ = io.WriteString(w, ": keep-alive\n\n")
				flush()
			}
		}
	}
}

func writeFrame(w io.Writer, r ActivityEvent) {
	b, err := json.Marshal(r)
	if err != nil {
		return
	}
	fmt.Fprintf(w, "id: %s|%s\n", r.OccurredAt.UTC().Format(time.RFC3339Nano), r.ID)
	fmt.Fprintf(w, "data: %s\n\n", b)
}

func newer(r ActivityEvent, lastTime time.Time, lastID string) bool {
	if lastTime.IsZero() {
		return true
	}
	if r.OccurredAt.After(lastTime) {
		return true
	}
	return r.OccurredAt.Equal(lastTime) && r.ID > lastID
}

func parseCursor(lastEventID string) (time.Time, string) {
	if lastEventID == "" {
		return time.Time{}, ""
	}
	for i := 0; i < len(lastEventID); i++ {
		if lastEventID[i] == '|' {
			if t, err := time.Parse(time.RFC3339Nano, lastEventID[:i]); err == nil {
				return t, lastEventID[i+1:]
			}
			break
		}
	}
	return time.Time{}, ""
}
