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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import {
  FRESHNESS_POLL_DELAY_MS,
  invalidateDependencyFreshness,
  scheduleFreshnessPoll,
} from "./dependencyFreshness";
import { specKeys } from "./keys";
import { projectKeys } from "../../projects/api/keys";

function fakeQueryClient() {
  return { invalidateQueries: vi.fn() } as unknown as QueryClient;
}

describe("invalidateDependencyFreshness", () => {
  it("invalidates both the dependencies and build-preflight query keys", () => {
    const qc = fakeQueryClient();
    invalidateDependencyFreshness(qc, "proj1");
    expect(qc.invalidateQueries).toHaveBeenCalledWith({
      queryKey: specKeys.dependencies("proj1"),
    });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({
      queryKey: projectKeys.buildPreflight("proj1"),
    });
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(2);
  });
});

describe("scheduleFreshnessPoll", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("invalidates immediately, then again after the quiet-period delay", () => {
    const qc = fakeQueryClient();
    scheduleFreshnessPoll(qc, "proj1");
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(2); // immediate: 2 keys

    vi.advanceTimersByTime(FRESHNESS_POLL_DELAY_MS - 1);
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(2); // not yet

    vi.advanceTimersByTime(1);
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(4); // follow-up: 2 more
  });

  it("a returned cancel() suppresses the follow-up poll", () => {
    const qc = fakeQueryClient();
    const cancel = scheduleFreshnessPoll(qc, "proj1");
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(2);

    cancel();
    vi.advanceTimersByTime(FRESHNESS_POLL_DELAY_MS);
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(2); // no follow-up fired
  });

  // Fix wave 1 (Important #1): `useTurnEndDependencyRefresh` uses this to
  // skip the up-front invalidate when a deterministic flush owner is already
  // handling it, while keeping the delayed backstop armed regardless.
  it("immediate: false skips the up-front invalidate, keeping only the delayed follow-up", () => {
    const qc = fakeQueryClient();
    scheduleFreshnessPoll(qc, "proj1", undefined, { immediate: false });
    expect(qc.invalidateQueries).not.toHaveBeenCalled();

    vi.advanceTimersByTime(FRESHNESS_POLL_DELAY_MS - 1);
    expect(qc.invalidateQueries).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(2); // only the follow-up fired
  });
});
