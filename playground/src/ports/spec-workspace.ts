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
 * `FsSpecWorkspace` — the project-dir side of a workspace-shaped turn
 * (docs/design/playground.md §3/§5). Turns are workspace-shaped ONLY, so the
 * project folder is materialized per turn into a fake immutable snapshot on a
 * temp mount in the EXACT layout the service derives (the EvalWorkspace
 * pattern, org "play"):
 *
 *   <mount>/repos/play/<slug>/<slug>/snapshots/<sha>/…
 *   <mount>/repos/play/_skills/org-skills/snapshots/<sha>/skills/<name>/SKILL.md
 *
 * Snapshot "shas" are fake but content-addressed (40 hex), so identical states
 * share a dir and an EDITED skills library gets a fresh snapshot on the very
 * next turn (§8 hot-reload). `issues/` is excluded from SPEC-turn reads:
 * production spec turns never see tasks (they live in GitHub); issues enter
 * only the plan turn's INSTRUCTION (§5 phase 3).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { WorkspaceRef } from "@aep/agent-stream";
import { readProjectFiles, resolveWithin } from "@aep/agents/playground-kit";
import { filesSnapshotSha, renderSkillFiles, skillsSnapshotSha, type RepoSkill } from "@aep/agents/evals-kit";

/** The playground's fixed tenant — fence values only; they never reach the model. */
export const PLAY_ORG = "play";

/** A fence-valid project slug from the project directory name. */
export function projectSlug(projectDir: string): string {
  const raw = basename(projectDir).toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-{2,}/g, "-") // "--" is the conversation-id segment delimiter
    .replace(/^[.-]+/, "");
  return slug === "" ? "project" : slug.slice(0, 64);
}

/** The fence-valid namespaced conversation id for this project + use case. */
export function playConversationId(slug: string, useCase: string, uuid: string): string {
  return `org_${PLAY_ORG}--proj_${slug}--${useCase}--${uuid}`;
}

/** Stable content hash of a files map (drives D20 `filesChangedExternally`) — the snapshot sha itself. */
export function hashFiles(files: Record<string, string>): string {
  return filesSnapshotSha(files);
}

export class FsSpecWorkspace {
  /** The temp fixture mount the in-process server reads. */
  readonly mountRoot: string;
  readonly slug: string;

  constructor(readonly projectDir: string) {
    this.slug = projectSlug(projectDir);
    this.mountRoot = mkdtempSync(join(tmpdir(), "aep-play-ws-"));
  }

  /**
   * Read the project into a spec-turn files map: dot-entries, binaries and
   * derived artifacts drop (project-fs walk), and `issues/` is excluded —
   * see the module doc. The server applies the production turn filter
   * (`keepInTurnSnapshot`) when it reads the snapshot back.
   */
  readSpecFiles(): Record<string, string> {
    const all = readProjectFiles(this.projectDir);
    const out: Record<string, string> = {};
    for (const [path, content] of Object.entries(all)) {
      if (path === "issues" || path.startsWith("issues/")) continue;
      out[path] = content;
    }
    return out;
  }

  /** Materialize one turn's files into a fake immutable `snapshots/<sha>/` dir. */
  materializeFiles(files: Record<string, string>): string {
    const sha = hashFiles(files);
    this.mirror(join(this.mountRoot, "repos", PLAY_ORG, this.slug, this.slug, "snapshots", sha), files);
    return sha;
  }

  /**
   * Materialize the skill library into the FLAT snapshot layout
   * (`skills/<name>/SKILL.md` + references). Content-addressed per call — an
   * edited library yields a new snapshot next turn; `skillsRef` is mandatory,
   * so an empty library still materializes an (empty) snapshot dir.
   */
  materializeSkills(skills: readonly RepoSkill[]): string {
    const sha = skillsSnapshotSha(skills);
    this.mirror(join(this.mountRoot, "repos", PLAY_ORG, "_skills", "org-skills", "snapshots", sha), renderSkillFiles(skills));
    return sha;
  }

  private mirror(dir: string, files: Record<string, string>): void {
    if (existsSync(dir)) return;
    mkdirSync(dir, { recursive: true });
    for (const [path, content] of Object.entries(files)) this.write(dir, path, content);
  }

  /** Build one turn's `WorkspaceRef` (materializing files + skills as needed). */
  workspaceRef(conversationId: string, files: Record<string, string>, skills: readonly RepoSkill[]): WorkspaceRef {
    return {
      conversationId,
      turnId: randomUUID(),
      repoSlug: this.slug,
      ref: this.materializeFiles(files),
      skillsRef: this.materializeSkills(skills),
    };
  }

  private write(root: string, rel: string, content: string): void {
    const abs = resolveWithin(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }

  cleanup(): void {
    rmSync(this.mountRoot, { recursive: true, force: true });
  }
}
