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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/client", () => ({
  client: { GET: vi.fn() },
}));

import { client } from "../../../api/client";
import { useAttentionIssues } from "./queries";

const getMock = client.GET as unknown as ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  getMock.mockReset();
});

describe("useAttentionIssues", () => {
  it("merges issues with a non-empty AttentionReason across every project", async () => {
    getMock.mockImplementation((path: string, options: { params: { path?: { projectName?: string } } }) => {
      if (path === "/projects") {
        return Promise.resolve({
          data: { items: [{ name: "demo-shop" }, { name: "gym-tracker" }] },
          error: undefined,
        });
      }
      if (path === "/projects/{projectName}/issues") {
        const projectName = options.params.path?.projectName;
        if (projectName === "demo-shop") {
          return Promise.resolve({
            data: [
              { Number: 1, Title: "a", Body: "", URL: "u1", State: "open", StateReason: "", AttentionReason: "escalated", Labels: [] },
              { Number: 2, Title: "b", Body: "", URL: "u2", State: "open", StateReason: "", AttentionReason: "", Labels: [] },
            ],
            error: undefined,
          });
        }
        return Promise.resolve({
          data: [
            { Number: 3, Title: "c", Body: "", URL: "u3", State: "closed", StateReason: "not_planned", AttentionReason: "no_change_verdict", Labels: [] },
          ],
          error: undefined,
        });
      }
      throw new Error(`unexpected path ${path}`);
    });

    const { result } = renderHook(() => useAttentionIssues(), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(result.current.items).toEqual([
      { project: "demo-shop", number: 1, title: "a", url: "u1", reason: "escalated" },
      { project: "gym-tracker", number: 3, title: "c", url: "u3", reason: "no_change_verdict" },
    ]);
    expect(result.current.failedCount).toBe(0);
  });

  it("counts a failed project without dropping the others' results", async () => {
    getMock.mockImplementation((path: string, options: { params: { path?: { projectName?: string } } }) => {
      if (path === "/projects") {
        return Promise.resolve({
          data: { items: [{ name: "demo-shop" }, { name: "gym-tracker" }] },
          error: undefined,
        });
      }
      const projectName = options.params.path?.projectName;
      if (projectName === "demo-shop") {
        return Promise.resolve({ data: undefined, error: { code: "internal_error", message: "boom" } });
      }
      return Promise.resolve({
        data: [
          { Number: 3, Title: "c", Body: "", URL: "u3", State: "open", StateReason: "", AttentionReason: "escalated", Labels: [] },
        ],
        error: undefined,
      });
    });

    const { result } = renderHook(() => useAttentionIssues(), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(result.current.failedCount).toBe(1);
    expect(result.current.items).toEqual([
      { project: "gym-tracker", number: 3, title: "c", url: "u3", reason: "escalated" },
    ]);
  });
});
