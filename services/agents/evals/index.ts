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
 * The evals kit — the curated surface external harnesses (the root-level
 * playground) boot the real agents app with: the fixture workspace mount,
 * the in-process M2M client half, and the repo-skill loader. Exported as
 * `@aep/agents/evals-kit` (see package.json `exports`).
 */

export { EvalWorkspace, EVAL_ORG, EVAL_PROJECT, EVAL_REPO_SLUG, evalConversationId } from "./workspace.js";
export { EVAL_AUTH, signM2mToken, evalTurnHeaders } from "./auth.js";
export { loadRepoSkills, parseSkill, type RepoSkill } from "./skills.js";
export { fakeSha, filesSnapshotSha, renderSkillFiles, skillsSnapshotSha } from "./snapshot.js";
