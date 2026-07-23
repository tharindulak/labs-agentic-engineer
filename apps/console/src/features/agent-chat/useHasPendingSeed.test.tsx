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

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useHasPendingSeed } from "./useHasPendingSeed";
import { chatKeyFor, consumePendingSeed, setPendingSeed } from "./chatStore";

describe("useHasPendingSeed — drives AppLayout auto-opening the chat panel (#252 Task 5)", () => {
  it("is false with no pending seed, true once one is set, false again once consumed", () => {
    const { result } = renderHook(() => useHasPendingSeed("acme", "proj-a"));
    expect(result.current).toBe(false);

    act(() => setPendingSeed(chatKeyFor("acme", "proj-a"), "resolve dep X"));
    expect(result.current).toBe(true);

    // Minor #2 (fix wave 1): consumePendingSeed now notifies seed
    // subscribers too, so this useSyncExternalStore snapshot flips back to
    // false instead of staying stuck true after consumption.
    act(() => {
      consumePendingSeed(chatKeyFor("acme", "proj-a"));
    });
    expect(result.current).toBe(false);
  });

  it("is false without a project (no route to watch)", () => {
    const { result } = renderHook(() => useHasPendingSeed("acme", undefined));
    expect(result.current).toBe(false);
  });

  it("does not react to a seed set for a different project", () => {
    const { result } = renderHook(() => useHasPendingSeed("acme", "proj-b"));
    act(() => setPendingSeed(chatKeyFor("acme", "proj-c"), "for a different project"));
    expect(result.current).toBe(false);
    consumePendingSeed(chatKeyFor("acme", "proj-c"));
  });
});
