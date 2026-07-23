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

import "sync"

// ActivityHub is the in-process change bus behind the activity live-tail: a notify-only
// broker keyed by (org, project). It carries no payload and buffers no history
// — it only wakes attached SSE connections to re-read the newest events. Same
// design as execution.TaskStreamHub. Single-replica assumption (aep-api runs
// one replica); the known evolution when the BFF scales out is LISTEN/NOTIFY.
type ActivityHub struct {
	mu   sync.Mutex
	subs map[string]map[chan struct{}]struct{}
}

// NewActivityHub builds an empty hub.
func NewActivityHub() *ActivityHub {
	return &ActivityHub{subs: map[string]map[chan struct{}]struct{}{}}
}

func hubKey(orgID, projectID string) string { return orgID + "/" + projectID }

// Subscribe registers a listener for (org, project). The returned channel is
// signalled (coalesced) on every Notify; cancel deregisters it and is
// idempotent. Buffered(1) so a notify never blocks the writer and repeated
// notifies collapse into one wake-up.
func (h *ActivityHub) Subscribe(orgID, projectID string) (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	key := hubKey(orgID, projectID)

	h.mu.Lock()
	if h.subs[key] == nil {
		h.subs[key] = map[chan struct{}]struct{}{}
	}
	h.subs[key][ch] = struct{}{}
	h.mu.Unlock()

	var once sync.Once
	cancel := func() {
		once.Do(func() {
			h.mu.Lock()
			if m := h.subs[key]; m != nil {
				delete(m, ch)
				if len(m) == 0 {
					delete(h.subs, key)
				}
			}
			h.mu.Unlock()
		})
	}
	return ch, cancel
}

// Notify wakes every listener attached to (org, project). Nil-safe — writers
// hold the hub unconditionally, so an unwired hub is a silent no-op.
// Non-blocking: a full listener buffer is left alone (it re-reads on next drain).
func (h *ActivityHub) Notify(orgID, projectID string) {
	if h == nil {
		return
	}
	key := hubKey(orgID, projectID)
	h.mu.Lock()
	chans := make([]chan struct{}, 0, len(h.subs[key]))
	for ch := range h.subs[key] {
		chans = append(chans, ch)
	}
	h.mu.Unlock()
	for _, ch := range chans {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}
