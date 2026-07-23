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
 * The skill-supply seam (ADR-0002 + shared-volume-clone-architecture §12): ONE
 * interface the catalog builder (`prompt.ts`) and the skill loaders
 * (`tools/skill-tools.ts`) consume. The one production implementation is
 * `SnapshotSkillSource` (`conversation/load-workspace.ts`): the catalog is
 * scanned from the turn's immutable `_skills` snapshot dir and
 * `loadSkill`/`loadSkillReference` read bodies from disk ON DEMAND, so
 * progressive disclosure is truly lazy (D4 immutability makes the mid-turn
 * reads race-free). A skill-free turn uses `EMPTY_SKILL_SOURCE`.
 */

/** One catalog row: what the system prompt shows — never a body. */
export interface SkillCatalogEntry {
  name: string;
  description: string;
  /** True when the skill carries any aux file (docs, scripts, assets, …) — drives the loadSkillReference tool + catalog note. */
  hasReferences: boolean;
}

/** A loaded skill body plus its addressable reference paths. */
export interface LoadedSkillBody {
  /** The full guidance body (frontmatter stripped). */
  content: string;
  /** Every aux file path under the skill dir (docs, scripts, assets, …) `loadSkillReference` can read. */
  references: string[];
}

/**
 * The result of resolving one reference path: `undefined` for an unknown
 * name/path (never resolved raw against the fs — allowlisted against
 * `load(name).references`), `{ binary: true }` for a file that isn't valid
 * UTF-8 text (model-context surfaces never inline binary), otherwise the text.
 */
export type LoadedReference = { content: string } | { binary: true } | undefined;

/** The seam both tool sets and the prompt builder read skills through. */
export interface SkillSource {
  /** The ordered catalog (order fixes the prompt's listing and the `available` echo). */
  catalog(): readonly SkillCatalogEntry[];
  /** Body + reference paths for one skill; undefined for an unknown name. */
  load(name: string): LoadedSkillBody | undefined;
  /** One reference file: text content, a binary marker, or undefined (unknown name/path). */
  loadReference(name: string, path: string): LoadedReference;
}

/** The skill-free source (empty catalog, no loaders) consumers default to. */
export const EMPTY_SKILL_SOURCE: SkillSource = {
  catalog: () => [],
  load: () => undefined,
  loadReference: () => undefined,
};
