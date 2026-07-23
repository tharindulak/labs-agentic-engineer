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
 * One engineering-agent turn end to end — the §5 engine loop
 * (docs/design/playground.md), the direct descendant of the in-package
 * playground's `runTurn`:
 *
 *   read project → files map → materialize snapshot (+ working-tree skills)
 *   → POST one workspace-shape turn → stream parts → fold tool-calls
 *   → verify manifest sha256s (WARN, never block) → diff-write the project
 *   → materialize derived artifacts → record the folded hash (D20).
 *
 * The conversation itself is persisted by the SERVICE via the injected
 * `FileConversationStore` — this loop owns only the disk reconcile.
 */

import { FileBundle, applyToolCall, streamTurn, type StreamPart, type TurnRequest } from "@aep/agent-stream";
import { filterTurnSnapshot } from "@aep/agents/conversation/load-workspace";
import { sha256Hex } from "@aep/agents/shared/hash";
import { loadRepoSkills, type RepoSkill } from "../kit/skills.js";
import { reconcileDir, type FileChange } from "../kit/project-fs.js";
import { materializeDerived, type DerivedNote } from "../kit/derived.js";
import { FsSpecWorkspace, hashFiles, playConversationId } from "../ports/spec-workspace.js";
import type { ProjectState } from "../state/project.js";
import { saveProjectState } from "../state/project.js";

export interface TurnSession {
  projectDir: string;
  ws: FsSpecWorkspace;
  baseUrl: string;
  headers: Record<string, string>;
  state: ProjectState;
  /** Repo-root `skills/` — read fresh EVERY turn (§8 hot-reload). */
  skillsDir: string;
}

export interface SpecTurnOptions {
  /** Conversation use-case segment; spec phases share ONE `general` conversation. */
  useCase?: string;
  /** Overrides the project's general-conversation uuid (one-shot plan turns). */
  conversationUuid?: string;
  toolset?: "task-plan";
  mcp?: { url: string; token: string };
  /** Live rendering hook; every streamed part passes through it. */
  onPart?: (part: StreamPart) => void;
  /** Skip the disk reconcile (plan turns mutate nothing under specs/). */
  foldToDisk?: boolean;
}

export interface SpecTurnResult {
  parts: StreamPart[];
  toolCalls: StreamPart[];
  changes: FileChange[];
  derivedNotes: DerivedNote[];
  /** Paths whose folded sha256 disagreed with the server manifest (drift alarm). */
  manifestMismatches: string[];
  error?: string;
}

/** Run one turn with `instruction` (already composed — see engine/compose.ts). */
export async function runSpecTurn(session: TurnSession, instruction: string, opts: SpecTurnOptions = {}): Promise<SpecTurnResult> {
  const { projectDir, ws, state } = session;
  const useCase = opts.useCase ?? "general";
  const conversationId = playConversationId(state.slug, useCase, opts.conversationUuid ?? state.conversationUuid);
  const skills: RepoSkill[] = loadRepoSkills(session.skillsDir);

  const before = ws.readSpecFiles();
  // D20: a hand-edit between turns is first-class — flag it so the agent
  // re-reads rather than trusting its conversation memory.
  const filesChangedExternally = state.lastFoldedHash !== undefined && hashFiles(before) !== state.lastFoldedHash;

  const body: TurnRequest = {
    instruction,
    workspace: ws.workspaceRef(conversationId, before, skills),
    ...(filesChangedExternally ? { filesChangedExternally: true } : {}),
    ...(opts.toolset ? { toolset: opts.toolset } : {}),
    ...(opts.mcp ? { mcp: opts.mcp } : {}),
  };

  const parts: StreamPart[] = [];
  const toolCalls: StreamPart[] = [];
  let manifest: StreamPart | undefined;
  let streamError: string | undefined;
  try {
    for await (const part of streamTurn(session.baseUrl, conversationId, body, { headers: session.headers })) {
      parts.push(part);
      opts.onPart?.(part);
      if (part.type === "tool-call") toolCalls.push(part);
      if (part.type === "manifest") manifest = part;
      if (part.type === "error") streamError = String(part.error ?? "stream error");
    }
  } catch (e) {
    // Transport/pre-stream failure: leave the project untouched.
    return {
      parts,
      toolCalls,
      changes: [],
      derivedNotes: [],
      manifestMismatches: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }

  if (opts.foldToDisk === false) {
    return { parts, toolCalls, changes: [], derivedNotes: [], manifestMismatches: [], ...(streamError ? { error: streamError } : {}) };
  }

  // Fold the streamed tool-calls (canonical ops) over the SERVER'S filtered
  // view of the snapshot — the state the agent actually saw — then write the
  // diff. Tool-calls that streamed before a mid-stream error are real
  // server-side mutations, so they still apply.
  const view = filterTurnSnapshot(before);
  const bundle = new FileBundle(view);
  for (const tc of toolCalls) applyToolCall(bundle, tc);
  const folded = bundle.snapshot();

  // Cheap D14 parity: the terminal manifest's sha256s must match our fold.
  const manifestMismatches: string[] = [];
  if (manifest?.files) {
    for (const [path, sha] of Object.entries(manifest.files)) {
      const content = folded[path];
      if (content === undefined || sha256Hex(content) !== sha) manifestMismatches.push(path);
    }
  }

  // Rebuild the full project state: files the turn filter hid stay untouched;
  // deletions apply only to files the agent could see.
  const after: Record<string, string> = { ...before };
  for (const path of Object.keys(view)) {
    if (!(path in folded)) delete after[path];
  }
  Object.assign(after, folded);
  const changes = reconcileDir(projectDir, before, after, false);

  const derivedNotes = materializeDerived(projectDir, state.slug, changes, after);

  state.lastFoldedHash = hashFiles(ws.readSpecFiles());
  saveProjectState(projectDir, state);

  return { parts, toolCalls, changes, derivedNotes, manifestMismatches, ...(streamError ? { error: streamError } : {}) };
}
