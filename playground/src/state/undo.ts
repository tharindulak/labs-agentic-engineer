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
 * The MANDATORY pre-coding-run safety snapshot (docs/design/playground.md
 * §12): the coding agent runs bypassPermissions on the host, so every run is
 * preceded by a copy of the project (minus `.aep-playground/`, `node_modules`,
 * dot-dirs) into `.aep-playground/undo/<ts>/`, and `play undo` restores the
 * latest one. Restore is destructive to CURRENT files that also exist in the
 * snapshot scope — it replaces the project's tracked surface with the
 * snapshot; files created after the snapshot are removed.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR } from "./project.js";

const SKIP = new Set([STATE_DIR, "node_modules"]);

function undoRoot(projectDir: string): string {
  return join(projectDir, STATE_DIR, "undo");
}

function shouldCopy(name: string): boolean {
  return !SKIP.has(name) && !name.startsWith(".");
}

/** Snapshot the project; returns the snapshot dir. */
export function takeUndoSnapshot(projectDir: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(undoRoot(projectDir), stamp);
  mkdirSync(dest, { recursive: true });
  for (const e of readdirSync(projectDir, { withFileTypes: true })) {
    if (!shouldCopy(e.name)) continue;
    cpSync(join(projectDir, e.name), join(dest, e.name), { recursive: true });
  }
  return dest;
}

/** Newest-first snapshot dirs. */
export function listUndoSnapshots(projectDir: string): string[] {
  const root = undoRoot(projectDir);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse()
    .map((name) => join(root, name));
}

/**
 * Restore the given (or latest) snapshot: every top-level entry in the
 * snapshot scope is replaced; top-level entries created after the snapshot
 * (same scope rules) are removed. Returns the restored snapshot dir, or null
 * when none exists.
 */
export function restoreUndoSnapshot(projectDir: string, snapshotDir?: string): string | null {
  const src = snapshotDir ?? listUndoSnapshots(projectDir)[0];
  if (!src || !existsSync(src)) return null;

  const snapshotEntries = new Set(readdirSync(src));
  for (const e of readdirSync(projectDir, { withFileTypes: true })) {
    if (!shouldCopy(e.name)) continue;
    if (!snapshotEntries.has(e.name)) rmSync(join(projectDir, e.name), { recursive: true, force: true });
  }
  for (const name of snapshotEntries) {
    rmSync(join(projectDir, name), { recursive: true, force: true });
    cpSync(join(src, name), join(projectDir, name), { recursive: true });
  }
  return src;
}
