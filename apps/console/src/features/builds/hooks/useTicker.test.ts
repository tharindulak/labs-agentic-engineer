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
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDuration } from "../lib/ledger";
import { useTicker } from "./useTicker";

afterEach(() => {
  vi.useRealTimers();
});

describe("useTicker", () => {
  it("re-renders the duration every second while the build is open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T16:20:00Z"));

    // What the summary card does: a duration with no end, plus the ticker.
    const { result } = renderHook(() => {
      useTicker(true);
      return buildDuration("2026-08-14T16:20:00Z");
    });
    expect(result.current).toBe("0m 00s");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    // The assertion the bug report is about: the number MOVED without any
    // refetch, prop change, or new data arriving.
    expect(result.current).toBe("0m 03s");
  });

  it("does not tick for a settled build", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => {
      useTicker(false);
      return vi.getTimerCount();
    });
    expect(result.current).toBe(0);
  });

  it("clears its interval on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useTicker(true));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
