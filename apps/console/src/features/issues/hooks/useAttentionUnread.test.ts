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

// @vitest-environment jsdom
// jsdom for the hook cases below: `useAttentionUnread` reads and writes the
// seen set through localStorage. The pure helpers need nothing.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { AttentionIssue } from "../api/queries";
import { attentionKey, countUnseen, useAttentionUnread } from "./useAttentionUnread";

const item = (over: Partial<AttentionIssue> = {}): AttentionIssue => ({
  project: "demo-shop",
  number: 12,
  title: "t",
  url: "u",
  reason: "escalated",
  ...over,
});

describe("attentionKey", () => {
  it("combines project, issue number, and reason", () => {
    expect(attentionKey(item())).toBe("demo-shop:12:escalated");
  });

  it("changes when the reason changes, even for the same issue", () => {
    const a = attentionKey(item({ reason: "escalated" }));
    const b = attentionKey(item({ reason: "unverified_fix" }));
    expect(a).not.toBe(b);
  });
});

describe("countUnseen", () => {
  it("counts every item as unread when nothing has been seen", () => {
    const items = [item({ number: 1 }), item({ number: 2 })];
    expect(countUnseen(items, new Set())).toBe(2);
  });

  it("excludes items whose key is already in the seen set", () => {
    const items = [item({ number: 1 }), item({ number: 2 })];
    const seen = new Set([attentionKey(item({ number: 1 }))]);
    expect(countUnseen(items, seen)).toBe(1);
  });

  it("counts a recurred item again once its reason changes back to unread", () => {
    const resolved = new Set([attentionKey(item({ number: 1, reason: "escalated" }))]);
    // Same issue, but it cleared and re-entered a DIFFERENT attention state —
    // that's newsworthy again, unlike a plain timestamp watermark would allow.
    const recurred = [item({ number: 1, reason: "no_change_verdict" })];
    expect(countUnseen(recurred, resolved)).toBe(1);
  });

  it("keeps an unchanged item seen when it reappears identically", () => {
    const seen = new Set([attentionKey(item({ number: 1, reason: "unverified_fix" }))]);
    expect(countUnseen([item({ number: 1, reason: "unverified_fix" })], seen)).toBe(0);
  });

  it("returns 0 for an empty list", () => {
    expect(countUnseen([], new Set())).toBe(0);
  });
});

const SEEN_KEYS_STORAGE_KEY = "aep:issues:seenKeys";

function storedKeys(): string[] {
  return JSON.parse(localStorage.getItem(SEEN_KEYS_STORAGE_KEY) ?? "[]") as string[];
}

describe("useAttentionUnread", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("clears the badge for everything on screen when the bell is opened", () => {
    const items = [item({ number: 1 }), item({ number: 2 })];
    const { result } = renderHook(() => useAttentionUnread(items));

    expect(result.current.unreadCount).toBe(2);
    act(() => result.current.markAllSeen());
    expect(result.current.unreadCount).toBe(0);
  });

  it("re-badges an issue that re-enters the SAME reason it was seen under", () => {
    const a = item({ number: 1, reason: "unverified_fix" });
    const { result, rerender } = renderHook(
      ({ items }: { items: AttentionIssue[] }) => useAttentionUnread(items),
      { initialProps: { items: [a] } },
    );

    // The user opens the bell: A is seen.
    act(() => result.current.markAllSeen());
    expect(result.current.unreadCount).toBe(0);

    // A is adopted and closed — it leaves the attention list. The user opens
    // the bell again and finds it empty, which is what prunes A's key.
    rerender({ items: [] });
    act(() => result.current.markAllSeen());
    expect(storedKeys()).toEqual([]);

    // The same incident recurs through the same failure mode: same project,
    // same issue number, same reason. That is news again, not old news.
    rerender({ items: [a] });
    expect(result.current.unreadCount).toBe(1);
  });

  it("replaces the stored seen set rather than growing it forever", () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: AttentionIssue[] }) => useAttentionUnread(items),
      { initialProps: { items: [item({ number: 1 })] } },
    );
    act(() => result.current.markAllSeen());
    expect(storedKeys()).toEqual([attentionKey(item({ number: 1 }))]);

    // One issue swapped for another: the new set is the SAME SIZE as the old
    // but has different members, so a size-only guard would skip the write
    // and leave issue 1's key stranded in storage.
    rerender({ items: [item({ number: 2 })] });
    act(() => result.current.markAllSeen());

    expect(storedKeys()).toEqual([attentionKey(item({ number: 2 }))]);
  });
});
