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

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EvalWorkspace, EVAL_ORG } from "./workspace.js";
import type { RepoSkill } from "./skills.js";

const skill = (content: string): RepoSkill => ({ name: "go", description: "Go conventions", content });

function skillBodyInSnapshot(ws: EvalWorkspace, sha: string): string {
  return readFileSync(join(ws.root, "repos", EVAL_ORG, "_skills", "org-skills", "snapshots", sha, "skills", "go", "SKILL.md"), "utf8");
}

test("an edited skill library yields a NEW snapshot on the next materialize (hot-reload)", () => {
  const ws = new EvalWorkspace();
  try {
    const before = ws.materializeSkills([skill("Use table tests.")]);
    const after = ws.materializeSkills([skill("Use table tests. Prefer t.Run subtests.")]);
    assert.notEqual(after, before, "edited library must get a fresh content-addressed sha");
    assert.match(skillBodyInSnapshot(ws, after), /Prefer t\.Run subtests/);
    // The pre-edit snapshot stays immutable (per-SHA immutability).
    assert.doesNotMatch(skillBodyInSnapshot(ws, before), /Prefer t\.Run subtests/);
  } finally {
    ws.cleanup();
  }
});

test("an unchanged skill library reuses its snapshot sha", () => {
  const ws = new EvalWorkspace();
  try {
    const a = ws.materializeSkills([skill("Use table tests.")]);
    const b = ws.materializeSkills([skill("Use table tests.")]);
    assert.equal(a, b);
  } finally {
    ws.cleanup();
  }
});
