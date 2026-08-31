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

/**
 * Frame ORDER within one step that issues several tool calls — a contract the
 * console depends on, not an SDK detail.
 *
 * The SDK flushes a step's tool results as a group after its LAST tool call, so
 * `tool-result` says "the step's work is done", never "this call's work is done".
 * The console used to key its per-file spinner off `tool-result`; once the design
 * turn began batching five `addFile`s into one step, all five cards spun for the
 * whole batch and settled together, minutes after the earlier files had landed.
 * `tool-input-end` is the per-call signal that fixes it — for a file tool the
 * arguments ARE the body, so a closed input stream means the file is complete.
 *
 * If an SDK upgrade changed this ordering, the spinners would silently break
 * again; that is what these assertions are for.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { FileBundle, type StreamPart } from "@aep/agent-stream";
import { runTurn } from "../src/agents/main/run-turn.js";
import { buildFileTools } from "../src/agents/main/tools/files.js";

const FILES: ReadonlyArray<readonly [string, string]> = [
  ["specs/design/design.md", "# Design\n"],
  ["specs/design/notes.md", "# Notes\n"],
  ["specs/design/components/web/wireframes.dsl", "screen Home\n"],
];

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

/**
 * One step issuing N `addFile` calls, each streaming its arguments to completion
 * before the next begins — how a provider serialises parallel tool calls.
 *
 * The chunks are spread over wall-clock time on purpose: delivered in one
 * synchronous gulp, every `execute()` would resolve after the stream drained and
 * the result ordering below would be an artifact of the fixture rather than of
 * the SDK.
 */
function batchedStep(): { stream: ReadableStream<unknown> } {
  const parts: unknown[] = [{ type: "stream-start", warnings: [] }];
  FILES.forEach(([path, content], i) => {
    const id = `call-${i}`;
    const input = JSON.stringify({ path, content });
    parts.push({ type: "tool-input-start", id, toolName: "addFile" });
    for (let c = 0; c < input.length; c += 24) {
      parts.push({ type: "tool-input-delta", id, delta: input.slice(c, c + 24) });
    }
    parts.push({ type: "tool-input-end", id });
    parts.push({ type: "tool-call", toolCallId: id, toolName: "addFile", input });
  });
  parts.push({ type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage: USAGE });
  return { stream: simulateReadableStream({ chunks: parts as never[], initialDelayInMs: 0, chunkDelayInMs: 1 }) };
}

function closingStep(): { stream: ReadableStream<unknown> } {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "done" },
        { type: "text-end", id: "t" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: USAGE },
      ] as never[],
      initialDelayInMs: 0,
      chunkDelayInMs: 0,
    }),
  };
}

async function collectFrames(): Promise<StreamPart[]> {
  const model = new MockLanguageModelV4({ doStream: [batchedStep(), closingStep()] as never });
  const frames: StreamPart[] = [];
  await runTurn({
    model: model as never,
    instructions: "batch",
    prompt: "write the files",
    messages: [],
    tools: buildFileTools(new FileBundle({})),
    onEvent: (p) => frames.push(p),
  });
  return frames;
}

const idOf = (p: StreamPart): string =>
  (p as { id?: string; toolCallId?: string }).id ?? (p as { toolCallId?: string }).toolCallId ?? "";

test("a batched step emits every tool-input-end before any tool-result", async () => {
  const frames = await collectFrames();
  const order = frames.map((f) => f.type);

  const lastInputEnd = order.lastIndexOf("tool-input-end");
  const firstResult = order.indexOf("tool-result");
  assert.ok(lastInputEnd >= 0, "the SDK must still emit tool-input-end");
  assert.ok(firstResult >= 0, "the step must produce results");
  assert.ok(
    lastInputEnd < firstResult,
    `every input-end must precede the first result (input-end@${lastInputEnd}, result@${firstResult})`,
  );
});

test("results flush as a GROUP after the last call — so they cannot mark one call done", async () => {
  const frames = await collectFrames();
  const order = frames.map((f) => f.type);
  // This is the defect the console has to design around: the FIRST result lands
  // only after the LAST call, so file 1 waits on file N.
  assert.ok(
    order.indexOf("tool-result") > order.lastIndexOf("tool-call"),
    "if results ever interleave with calls, the console could key off tool-result again",
  );
  assert.equal(order.filter((t) => t === "tool-result").length, FILES.length);
});

test("each tool-input-end carries the id its own tool-call uses, so a card updates in place", async () => {
  const frames = await collectFrames();
  const endIds = frames.filter((f) => f.type === "tool-input-end").map(idOf);
  const callIds = frames.filter((f) => f.type === "tool-call").map(idOf);
  const resultIds = frames.filter((f) => f.type === "tool-result").map(idOf);
  assert.deepEqual(endIds, callIds, "input-end and tool-call must share the id (and its order)");
  assert.deepEqual([...resultIds].sort(), [...callIds].sort(), "every call settles exactly once");
  assert.equal(new Set(endIds).size, FILES.length, "ids must be distinct per call");
});

test("every file lands in the bundle — batching changes ordering, not outcomes", async () => {
  const bundle = new FileBundle({});
  const model = new MockLanguageModelV4({ doStream: [batchedStep(), closingStep()] as never });
  await runTurn({
    model: model as never,
    instructions: "batch",
    prompt: "write the files",
    messages: [],
    tools: buildFileTools(bundle),
    onEvent: () => {},
  });
  for (const [path, content] of FILES) {
    assert.equal(bundle.read(path), content, `${path} must be present with its streamed body`);
  }
});
