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
 * Path-parameterized project-folder I/O — the dir-agnostic core `threads.ts`
 * (the in-package chat playground) and the root-level playground's
 * `FsSpecWorkspace` both build on: read a folder into the POSIX-relative
 * path→content map a workspace snapshot is materialized from, and reconcile an
 * agent's reconstructed snapshot back to disk. Keys are POSIX-relative;
 * dot-entries and binary files are skipped; every write is sandboxed inside
 * the root (the model supplies the keys).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export type ChangeKind = "add" | "edit" | "remove";
export interface FileChange {
  kind: ChangeKind;
  path: string;
}

function walk(dir: string, rel: string, out: Record<string, string>): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue; // skip dot-entries (.git, .DS_Store, …)
    const abs = join(dir, e.name);
    const key = rel ? `${rel}/${e.name}` : e.name; // POSIX-relative key
    if (e.isDirectory()) {
      walk(abs, key, out);
      continue;
    }
    if (!e.isFile()) continue;
    // Derived artifacts (compiled .excalidraw, projected *.gen.json) never
    // enter the bundle: the agent must not see or edit them, and inlining
    // generated JSON into every turn's prompt would be pure token waste.
    if (e.name.endsWith(".excalidraw") || e.name.endsWith(".gen.json")) continue;
    const buf = readFileSync(abs);
    if (buf.includes(0)) continue; // a NUL byte → binary; the agent only edits text
    out[key] = buf.toString("utf8");
  }
}

/** Read a project folder into the map a turn's workspace snapshot is built from. */
export function readProjectFiles(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (existsSync(root)) walk(root, "", out);
  return out;
}

/** Resolve a snapshot key under `root`, refusing anything that escapes it. */
export function resolveWithin(root: string, key: string): string {
  const abs = resolve(root, key);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`path "${key}" escapes the project directory`);
  }
  return abs;
}

/**
 * Diff `before` (read at turn start) against `after` (the agent's reconstructed
 * snapshot) and, unless `dryRun`, write the changes to disk under `root`:
 * new/edited files written, vanished files deleted. Returns the change list
 * either way.
 */
export function reconcileDir(
  root: string,
  before: Record<string, string>,
  after: Record<string, string>,
  dryRun: boolean,
): FileChange[] {
  const absRoot = resolve(root);
  const changes: FileChange[] = [];

  for (const [path, content] of Object.entries(after)) {
    if (!(path in before)) changes.push({ kind: "add", path });
    else if (before[path] !== content) changes.push({ kind: "edit", path });
    else continue; // unchanged
    if (!dryRun) {
      const abs = resolveWithin(absRoot, path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
    }
  }

  for (const path of Object.keys(before)) {
    if (path in after) continue;
    changes.push({ kind: "remove", path });
    if (!dryRun) rmSync(resolveWithin(absRoot, path), { force: true });
  }

  return changes;
}
