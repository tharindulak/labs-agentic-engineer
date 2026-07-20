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
 * Spike 0a (docs/design/playground.md §13) — go/no-go probes, no cluster:
 *
 *  1. Import the real agents app from OUTSIDE services/agents via the curated
 *     `exports` map, boot it with a mock model, and run the whole §5 engine
 *     loop against a temp project dir: read dir → materialize snapshot →
 *     workspace-shape turn → stream → fold → diff-write back.
 *  2. A `toolset:"task-plan"` turn with INSTRUCTION-carried existing-task
 *     context: prove the server-side accumulator rejects
 *     `updateTask{issueNumber}` (UNKNOWN_REF — matching production, where the
 *     snapshot never carries tasks/) while `updateTask{title}` on a task
 *     planned this turn succeeds.
 *
 * Run: pnpm --filter @aep/playground exec tsx spike/spike-0a.ts
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "@aep/agents/server";
import { InMemoryConversationStore } from "@aep/agents/store/memory-store";
import { mockModel } from "@aep/agents/shared/mock-model";
import { listen0 } from "@aep/agents/shared/listen";
import { filterTurnSnapshot } from "@aep/agents/conversation/load-workspace";
import { EvalWorkspace, EVAL_ORG, EVAL_AUTH, evalConversationId, evalTurnHeaders } from "@aep/agents/evals-kit";
import { FileBundle, applyToolCall, streamTurn, type StreamPart, type TurnRequest } from "@aep/agent-stream";
import type { LanguageModel } from "ai";

async function boot(model: LanguageModel, mountRoot: string) {
  const store = new InMemoryConversationStore();
  const app = createApp({
    store,
    buildModel: () => model,
    auth: { audience: EVAL_AUTH.audience, secret: EVAL_AUTH.secret },
    workspaceMountRoot: mountRoot,
  });
  return listen0(app.listen(0));
}

async function collect(baseUrl: string, id: string, body: TurnRequest, headers: Record<string, string>): Promise<StreamPart[]> {
  const parts: StreamPart[] = [];
  for await (const part of streamTurn(baseUrl, id, body, { headers })) parts.push(part);
  return parts;
}

/** Read a dir into a POSIX-relative files map (dot-entries skipped) — FsSpecWorkspace's core. */
function readDir(root: string, rel = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const key = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(out, readDir(root, key));
    else if (e.isFile()) out[key] = readFileSync(join(root, rel, e.name), "utf8");
  }
  return out;
}

async function spike1_engineLoop(): Promise<void> {
  const projectDir = mkdtempSync(join(tmpdir(), "aep-play-spike-"));
  const ws = new EvalWorkspace();
  const model = mockModel([
    {
      kind: "toolCall",
      toolCallId: "tc1",
      toolName: "addFile",
      input: { path: "specs/requirements/requirements.md", content: "# Requirements\n\n- users can create todos\n" },
      text: "Creating the requirements document.",
    },
    { kind: "text", text: "Requirements generated." },
  ]);
  const { baseUrl, close } = await boot(model, ws.root);
  try {
    const id = evalConversationId("spike-0a");
    const headers = await evalTurnHeaders("spike-key", EVAL_ORG);
    const before = readDir(projectDir);
    const body: TurnRequest = {
      instruction: "Generate a complete requirements specification (requirements/requirements.md) for this project.",
      workspace: ws.workspaceRef(id, 0, before, []),
    };
    const parts = await collect(baseUrl, id, body, headers);
    const toolCalls = parts.filter((p) => p.type === "tool-call");
    assert.equal(toolCalls.length, 1, "one tool-call frame expected");

    // Fold over the server's filtered view, then diff-write the project dir.
    const view = filterTurnSnapshot(before);
    const bundle = new FileBundle(view);
    for (const tc of toolCalls) applyToolCall(bundle, tc);
    const folded = bundle.snapshot();
    for (const [path, content] of Object.entries(folded)) {
      if (before[path] === content) continue;
      const abs = join(projectDir, path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
    }
    assert.ok(existsSync(join(projectDir, "specs/requirements/requirements.md")), "requirements.md landed in the project dir");
    const written = readFileSync(join(projectDir, "specs/requirements/requirements.md"), "utf8");
    assert.match(written, /users can create todos/);
    console.log("✓ spike 1: external createApp import + full engine loop (dir → snapshot → turn → fold → dir)");
  } finally {
    await close();
    ws.cleanup();
    rmSync(projectDir, { recursive: true, force: true });
  }
}

async function spike2_taskPlanChannel(): Promise<void> {
  const ws = new EvalWorkspace();
  // Snapshot: one known component, NO tasks/ files (production parity — the
  // repo snapshot never carries task renderings).
  const seed: Record<string, string> = {
    "specs/design/design.md": "# Design\n",
    "specs/design/components/user-service/design.json": JSON.stringify({ name: "user-service" }),
  };
  // Existing task rides the INSTRUCTION, exactly like plan.go renderPlanContext.
  const existingTaskRender =
    "\n\n## Existing open Tasks and lineage diffs (reference)\n" +
    '\n--- tasks/7.md ---\n---\nissueNumber: 7\ncomponent: "user-service"\ntitle: "Old task"\ndependsOn: []\norigin: "spec-plan"\n---\n\nold body\n\n';
  const model = mockModel([
    {
      kind: "toolCall",
      toolCallId: "p1",
      toolName: "planTask",
      input: { component: "user-service", title: "Build user service", dependsOn: [], rationale: "covers the user-service design" },
    },
    {
      kind: "toolCall",
      toolCallId: "u1",
      toolName: "updateTask",
      input: { ref: { issueNumber: 7 }, set: { body: "should be rejected" } },
    },
    {
      kind: "toolCall",
      toolCallId: "u2",
      toolName: "updateTask",
      input: { ref: { title: "Build user service" }, set: { body: "## Scope\nimplement the service" } },
    },
    { kind: "text", text: "Plan complete." },
  ]);
  const { baseUrl, close } = await boot(model, ws.root);
  try {
    const id = evalConversationId("spike-0a-plan");
    const headers = await evalTurnHeaders("spike-key", EVAL_ORG);
    const body: TurnRequest = {
      instruction: "Plan the implementation Tasks for this project." + existingTaskRender,
      workspace: ws.workspaceRef(id, 0, seed, []),
      toolset: "task-plan",
    };
    const parts = await collect(baseUrl, id, body, headers);
    const results = parts.filter((p) => p.type === "tool-result");
    assert.equal(results.length, 3, `three tool-results expected, got ${results.length}`);

    const [planRes, updByNumber, updByTitle] = results as Array<StreamPart & { output?: unknown }>;
    const out = (p: unknown): Record<string, unknown> => (p as { output: Record<string, unknown> }).output;
    assert.equal(out(planRes).ok, true, "planTask should succeed");
    assert.equal(out(updByNumber).ok, false, "updateTask{issueNumber} with instruction-carried context should be REJECTED");
    assert.equal(out(updByNumber).code, "UNKNOWN_REF", "rejection code should be UNKNOWN_REF");
    assert.equal(out(updByTitle).ok, true, "updateTask{title} on a this-turn task should succeed");
    console.log("✓ spike 2: task-plan channel — instruction-carried context; updateTask{issueNumber} → UNKNOWN_REF (production parity), updateTask{title} → ok");
  } finally {
    await close();
    ws.cleanup();
  }
}

await spike1_engineLoop();
await spike2_taskPlanChannel();
console.log("spike 0a: PASS");
