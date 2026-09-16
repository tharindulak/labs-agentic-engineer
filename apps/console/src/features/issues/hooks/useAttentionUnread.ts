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

// Same members, not merely the same count — a replace can swap one key for
// another and leave the size untouched, so a size check would miss it.
function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((key) => b.has(key));
}

// The seen set is exactly "the keys that were on screen the last time the
// user looked" — a replace, not a union. A union would grow in localStorage
// forever, and (the reason the set exists at all) would keep an issue silent
// when it clears an attention state and later re-enters the SAME one: the
// stale key would still be there. Pruning happens here, on the user's own
// act of looking, rather than reactively on `items` — `items` goes empty on
// every refetch blip, and pruning on that would keep re-announcing events
// the user has already seen.
export function nextSeenKeys(items: AttentionIssue[]): Set<string> {
  return new Set(items.map(attentionKey));
}

export function useAttentionUnread(items: AttentionIssue[]) {
  const [seenKeys, setSeenKeys] = useState<Set<string>>(readSeenKeys);

  const unreadCount = useMemo(() => countUnseen(items, seenKeys), [items, seenKeys]);

  const markAllSeen = useCallback(() => {
    const next = nextSeenKeys(items);
    if (sameKeys(next, seenKeys)) return;
    writeSeenKeys(next);
    setSeenKeys(next);
  }, [items, seenKeys]);

  return { unreadCount, markAllSeen };
}
