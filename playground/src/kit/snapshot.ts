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
 * Fake-snapshot content addressing + skill-file rendering, shared by every
 * fixture workspace (EvalWorkspace here, the playground's FsSpecWorkspace).
 * ONE definition of the sha canonicalization and the SKILL.md layout — the
 * two mounts must never drift, or an edited skill library would stop getting
 * a fresh snapshot in one of them.
 */

import { stringify as stringifyYaml } from "yaml";
import { sha256Hex } from "@aep/agents/shared/hash";
import type { RepoSkill } from "./skills.js";

/** Deterministic fake 40-hex "sha" for a content payload (content-addressed dirs). */
export function fakeSha(payload: string): string {
  return sha256Hex(payload).slice(0, 40);
}

/** The files-map snapshot sha (also the D20 `filesChangedExternally` hash). */
export function filesSnapshotSha(files: Record<string, string>): string {
  return fakeSha(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));
}

/** The skill-library snapshot sha — an edited library yields a new one. */
export function skillsSnapshotSha(skills: readonly RepoSkill[]): string {
  return fakeSha(JSON.stringify(skills.map((s) => [s.name, s.description, s.content, s.references ?? {}])));
}

/**
 * Render a skill library into the FLAT snapshot files map
 * (`skills/<name>/SKILL.md` + references — the shape reconcile writes to
 * every org-skills repo).
 */
export function renderSkillFiles(skills: readonly RepoSkill[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const skill of skills) {
    const front = stringifyYaml({ name: skill.name, description: skill.description }).replace(/\n+$/, "");
    out[`skills/${skill.name}/SKILL.md`] = `---\n${front}\n---\n\n${skill.content}\n`;
    for (const [refPath, body] of Object.entries(skill.references ?? {})) {
      out[`skills/${skill.name}/${refPath}`] = body;
    }
  }
  return out;
}
