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

import { describe, expect, it } from "vitest";
import type { AttentionIssue } from "../api/queries";
import { attentionKey, countUnseen } from "./useAttentionUnread";

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

  it("returns 0 for an empty list", () => {
    expect(countUnseen([], new Set())).toBe(0);
  });
});
