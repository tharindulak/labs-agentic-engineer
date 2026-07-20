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
 * A thread is a folder under `chat_playground/` whose name doubles as the
 * conversation-id suffix (the playground namespaces it per §12). This module
 * owns the thread NAMING + LISTING; the folder I/O itself (read into a
 * path→content map, reconcile the agent's snapshot back to disk) is the
 * path-parameterized `project-fs.ts` core, shared with the root-level
 * playground.
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readProjectFiles, reconcileDir, type FileChange } from "./project-fs.js";

export type { ChangeKind, FileChange } from "./project-fs.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Thread data lives next to the code, under `services/agents/chat_playground/` (gitignored). */
export const THREADS_ROOT = join(here, "..", "chat_playground");

// A legal directory name AND a clean conversation-id suffix — no separators,
// no `..`, and no `--` (the namespaced id's segment delimiter, §12).
const NAME_RE = /^[A-Za-z0-9._-]+$/;

export function isValidThreadName(name: string): boolean {
  return NAME_RE.test(name) && name !== "." && name !== ".." && !name.includes("--") && !name.startsWith(".");
}

export function threadDir(name: string): string {
  return join(THREADS_ROOT, name);
}

/** Create the thread folder if absent (reopen-on-exist; no scaffolding). */
export function ensureThread(name: string): void {
  mkdirSync(threadDir(name), { recursive: true });
}

export interface ThreadInfo {
  name: string;
  fileCount: number;
}

/** Every thread folder, sorted, with its current text-file count. */
export function listThreads(): ThreadInfo[] {
  if (!existsSync(THREADS_ROOT)) return [];
  return readdirSync(THREADS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => ({ name: d.name, fileCount: Object.keys(readSnapshot(d.name)).length }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Read the whole thread folder into the map a turn's workspace snapshot is built from. */
export function readSnapshot(name: string): Record<string, string> {
  return readProjectFiles(threadDir(name));
}

/**
 * Diff `before` (read at turn start) against `after` (the agent's reconstructed
 * snapshot) and, unless `dryRun`, write the changes to disk: new/edited files
 * written, vanished files deleted. Returns the change list either way.
 */
export function reconcile(
  name: string,
  before: Record<string, string>,
  after: Record<string, string>,
  dryRun: boolean,
): FileChange[] {
  return reconcileDir(threadDir(name), before, after, dryRun);
}
