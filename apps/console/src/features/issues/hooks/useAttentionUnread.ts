/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { useCallback, useMemo, useState } from "react";
import type { AttentionIssue } from "../api/queries";

// Client-side only, same as the alerts bell's watermark — no server
// read-state for this either. Unlike a timestamp watermark, though, these
// events aren't a monotonic timeline: an issue can clear one attention
// state and later enter a DIFFERENT one (e.g. an unverified fix gets
// closed, then the same incident recurs and escalates), which must count
// as unread again. So the seen-set is keyed by (project, issue, reason),
// not by a "seen up to this time" cutoff.
const SEEN_KEYS_STORAGE_KEY = "aep:issues:seenKeys";

function readSeenKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEYS_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeSeenKeys(keys: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEYS_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Storage unavailable (e.g. private browsing) — badge just won't persist across reloads.
  }
}

// Pure logic, exported for unit testing (see useAttentionUnread.test.ts).
export function attentionKey(item: AttentionIssue): string {
  return `${item.project}:${item.number}:${item.reason}`;
}

export function countUnseen(items: AttentionIssue[], seenKeys: ReadonlySet<string>): number {
  return items.filter((item) => !seenKeys.has(attentionKey(item))).length;
}

export function useAttentionUnread(items: AttentionIssue[]) {
  const [seenKeys, setSeenKeys] = useState<Set<string>>(readSeenKeys);

  const unreadCount = useMemo(() => countUnseen(items, seenKeys), [items, seenKeys]);

  const markAllSeen = useCallback(() => {
    const next = new Set(seenKeys);
    for (const item of items) next.add(attentionKey(item));
    if (next.size !== seenKeys.size) {
      writeSeenKeys(next);
      setSeenKeys(next);
    }
  }, [items, seenKeys]);

  return { unreadCount, markAllSeen };
}
