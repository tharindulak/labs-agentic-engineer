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
 * The eval-side workspace fixture tree (§12: "agents stays replayable in evals
 * by pointing WORKSPACE_MOUNT_ROOT at a fixture tree containing fake
 * `snapshots/<sha>/` dirs"). Materializes a turn's `files` map — and the skill
 * library — into the exact mount layout the service derives:
 *
 *   <root>/repos/<org>/<proj>/<slug>/snapshots/<sha>/…
 *   <root>/repos/<org>/_skills/org-skills/snapshots/<sha>/skills/<kind>/<name>/SKILL.md
 *
 * Snapshot "shas" are fake but content-addressed (40 hex of the content hash),
 * so identical states share a dir — mirroring per-SHA immutability. Only
 * `evals/` touches the filesystem.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WorkspaceRef } from "@aep/agent-stream";
import { DiskMirror } from "./disk.js";
import type { RepoSkill } from "./skills.js";
import { filesSnapshotSha, renderSkillFiles, skillsSnapshotSha } from "./snapshot.js";

export const EVAL_ORG = "eval-org";
export const EVAL_PROJECT = "eval-proj";
export const EVAL_REPO_SLUG = "eval-repo";
export const EVAL_USE_CASE = "requirements-generate";

/** The namespaced conversation id the workspace shape requires (fence-valid). */
export function evalConversationId(suffix: string): string {
  return `org_${EVAL_ORG}--proj_${EVAL_PROJECT}--${EVAL_USE_CASE}--${suffix}`;
}

/** One per-sample fixture mount; `cleanup()` removes the whole tree. */
export class EvalWorkspace {
  readonly root: string;

  constructor() {
    this.root = mkdtempSync(join(tmpdir(), "aep-eval-ws-"));
  }

  /**
   * Materialize the skill library into the FLAT snapshot layout
   * (`skills/<name>/SKILL.md` — the shape reconcile writes to every
   * org-skills repo). Returns the snapshot "sha". Called lazily by
   * `workspaceRef`. Content-addressed per call — an EDITED library yields a
   * new snapshot on the next turn (the playground's hot-reload loop), while
   * an unchanged one reuses its existing dir via the `existsSync` dedupe.
   */
  materializeSkills(skills: readonly RepoSkill[]): string {
    const sha = skillsSnapshotSha(skills);
    const dir = join(this.root, "repos", EVAL_ORG, "_skills", "org-skills", "snapshots", sha);
    this.mirror(dir, renderSkillFiles(skills));
    return sha;
  }

  /** Materialize one turn's `files` into a fake immutable `snapshots/<sha>/` dir. */
  materializeFiles(files: Record<string, string>): string {
    const sha = filesSnapshotSha(files);
    const dir = join(this.root, "repos", EVAL_ORG, EVAL_PROJECT, EVAL_REPO_SLUG, "snapshots", sha);
    this.mirror(dir, files);
    return sha;
  }

  private mirror(dir: string, files: Record<string, string>): void {
    if (existsSync(dir)) return;
    mkdirSync(dir, { recursive: true });
    const mirror = new DiskMirror(dir);
    for (const [path, content] of Object.entries(files)) mirror.write(path, content);
  }

  /** Build the turn's `WorkspaceRef` (materializing files + skills as needed). */
  workspaceRef(conversationId: string, turnIndex: number, files: Record<string, string>, skills: readonly RepoSkill[]): WorkspaceRef {
    return {
      conversationId,
      turnId: `turn-${turnIndex + 1}`,
      repoSlug: EVAL_REPO_SLUG,
      ref: this.materializeFiles(files),
      skillsRef: this.materializeSkills(skills),
    };
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
