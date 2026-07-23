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

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDesignCellChangeCount } from "./useDesignCellChange";

function setup(live: string | null, active: boolean) {
  return renderHook(
    (p: { live: string | null; active: boolean }) =>
      useDesignCellChangeCount(p.live, p.active),
    { initialProps: { live, active } },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(60_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDesignCellChangeCount", () => {
  it("does not count the initial value", () => {
    const { result } = setup("title X\n", true);
    expect(result.current).toBe(0);
  });

  it("counts an editFile patch landing (one atomic content change)", () => {
    const { result, rerender } = setup("title X\n", true);
    rerender({ live: "title X\nsouth email-provider\n", active: true });
    expect(result.current).toBe(1);
  });

  it("coalesces rapid deltas (streamed lines / consecutive edits) into one burst", () => {
    const { result, rerender } = setup("title X\n", true);
    rerender({ live: "title X\nsouth email-provider\n", active: true });
    vi.setSystemTime(61_000);
    rerender({ live: "title X\nsouth email-provider\napi -> email-provider\n", active: true });
    expect(result.current).toBe(1);
  });

  it("counts a later change after a quiet period as a new burst", () => {
    const { result, rerender } = setup("v1", true);
    rerender({ live: "v1 delta", active: true });
    vi.setSystemTime(70_000);
    rerender({ live: "v1 delta more", active: true });
    expect(result.current).toBe(2);
  });

  it("counts a restructure (content → null on removeFile, then re-stream) once", () => {
    const { result, rerender } = setup("title X\n", true);
    rerender({ live: null, active: true });
    vi.setSystemTime(61_000);
    rerender({ live: "title X\n", active: true });
    vi.setSystemTime(62_000);
    rerender({ live: "title X\nsouth email\n", active: true });
    expect(result.current).toBe(1);
  });

  it("ignores changes when inactive (no agent peer)", () => {
    const { result, rerender } = setup("title X\n", false);
    rerender({ live: "title X\nedited\n", active: false });
    expect(result.current).toBe(0);
  });

  it("ignores a disconnect (text nulls and active drops in the same render)", () => {
    const { result, rerender } = setup("title X\n", true);
    rerender({ live: null, active: false });
    expect(result.current).toBe(0);
  });
});
