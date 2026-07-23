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

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamPart } from "@aep/agent-stream";

// --- api/turns.js: openTurnStream/getTurn are the only calls runTurn makes.
const mockOpenTurnStream = vi.fn();
const mockGetTurn = vi.fn();
vi.mock("./api/turns.js", () => ({
  openTurnStream: (...args: unknown[]) => mockOpenTurnStream(...args),
  getTurn: (...args: unknown[]) => mockGetTurn(...args),
}));

// --- @aep/agent-stream: parseSseStream is mocked to yield the parts a test
// queues, bypassing real SSE byte parsing (irrelevant to this unit).
let queuedParts: StreamPart[] = [];
vi.mock("@aep/agent-stream", () => ({
  parseSseStream: async function* () {
    for (const part of queuedParts) yield part;
  },
  toChange: (part: { toolCallId?: string; result?: unknown }) => ({
    op: "add",
    path: "specs/design/components/checkout-api/design.json",
    result: part.result,
  }),
  opForTool: () => "add",
  readToolInputPath: () => null,
}));

const notified: { key: string; status: string }[] = [];
vi.mock("./chatStore.js", () => ({
  appendAssistantText: vi.fn(),
  addMessage: vi.fn(),
  upsertToolMessage: vi.fn(),
  setTurnStatus: vi.fn(),
  notifyTurnEnd: (key: string, status: string) => notified.push({ key, status }),
}));

import { attachAndFoldTurn } from "./runTurn";

const KEY = "aep.chat.v1.acme.proj1";

describe("attachAndFoldTurn — turn-end notification (#252 Task 5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queuedParts = [];
    notified.length = 0;
    mockOpenTurnStream.mockResolvedValue(new ReadableStream());
  });

  it("notifies turn-end with 'completed' on a turn-committed terminal frame", async () => {
    queuedParts = [{ type: "turn-committed" } as StreamPart];
    await attachAndFoldTurn(KEY, "proj1", "t1", new AbortController().signal);
    expect(notified).toEqual([{ key: KEY, status: "completed" }]);
  });

  it("notifies turn-end with 'failed' on a turn-failed terminal frame", async () => {
    queuedParts = [{ type: "turn-failed", message: "boom" } as StreamPart];
    await attachAndFoldTurn(KEY, "proj1", "t1", new AbortController().signal);
    expect(notified).toEqual([{ key: KEY, status: "failed" }]);
  });

  it("notifies turn-end via the poll fallback when the stream is severed with no terminal frame", async () => {
    queuedParts = []; // stream ends with nothing — severed before a terminal
    mockGetTurn.mockResolvedValue({ status: "completed" });
    await attachAndFoldTurn(KEY, "proj1", "t1", new AbortController().signal);
    expect(notified).toEqual([{ key: KEY, status: "completed" }]);
  });

  it("notifies turn-end 'failed' via the poll fallback when the authoritative poll says failed", async () => {
    queuedParts = [];
    mockGetTurn.mockResolvedValue({ status: "failed", message: "oops" });
    await attachAndFoldTurn(KEY, "proj1", "t1", new AbortController().signal);
    expect(notified).toEqual([{ key: KEY, status: "failed" }]);
  });

  it("does NOT notify turn-end when the signal is aborted (detach, not a terminal)", async () => {
    const ac = new AbortController();
    queuedParts = []; // aborted before any frame arrives
    ac.abort();
    await attachAndFoldTurn(KEY, "proj1", "t1", ac.signal);
    expect(notified).toEqual([]);
    expect(mockGetTurn).not.toHaveBeenCalled();
  });
});
