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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkill, loadRepoSkills } from "../src/kit/skills.js";

const here = dirname(fileURLToPath(import.meta.url));
// playground/test → repo root is two up; skills/ lives there (ADR-0002).
const repoSkillsDir = join(here, "..", "..", "skills");

test("parseSkill takes name+description from frontmatter and the (stripped) body as content", () => {
  const raw = "---\nname: foo\ndescription: does foo\n---\n# Foo\n\nbody text\n";
  const s = parseSkill("dir-id", raw);
  assert.equal(s.name, "foo");
  assert.equal(s.description, "does foo");
  assert.match(s.content, /# Foo/);
  assert.match(s.content, /body text/);
  assert.doesNotMatch(s.content, /name: foo/); // frontmatter is stripped from content
});

test("parseSkill falls back to the directory id when frontmatter name is absent", () => {
  const s = parseSkill("my-dir", "just a body, no frontmatter\n");
  assert.equal(s.name, "my-dir");
  assert.equal(s.description, "");
  assert.equal(s.content, "just a body, no frontmatter");
});

test("loadRepoSkills returns [] for a missing directory (skill-free checkout)", () => {
  assert.deepEqual(loadRepoSkills(join(here, "no-such-skills-dir")), []);
});

test("loadRepoSkills reads the committed repo-root skill library", () => {
  const skills = loadRepoSkills(repoSkillsDir);
  const names = skills.map((s) => s.name);
  assert.ok(names.includes("high-level-architecture"), JSON.stringify(names));
  const arch = skills.find((s) => s.name === "high-level-architecture")!;
  assert.notEqual(arch.description, "");
  assert.match(arch.content, /specs\/design\/components/);
  // The library's reference files ride along (agentskills.io structure).
  const oas = skills.find((s) => s.name === "openapi-conventions")!;
  assert.ok(oas.references?.["references/wso2-rest-api-design-guidelines.md"]);
  const wf = skills.find((s) => s.name === "excalidraw-wireframes")!;
  // The worked example is inlined in the body (read-before-write is load-bearing).
  assert.match(wf.content, /Worked example — risk register/);
});

test("loadRepoSkills reads references/*.md into the skill's references map", () => {
  const dir = mkdtempSync(join(tmpdir(), "aep-skills-"));
  try {
    const skillDir = join(dir, "with-refs");
    mkdirSync(join(skillDir, "references"), { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: with-refs\ndescription: has refs\n---\nbody\n");
    writeFileSync(join(skillDir, "references", "schema.md"), "the schema details\n");

    const plainDir = join(dir, "no-refs");
    mkdirSync(plainDir, { recursive: true });
    writeFileSync(join(plainDir, "SKILL.md"), "---\nname: no-refs\ndescription: plain\n---\nbody\n");

    const skills = loadRepoSkills(dir);
    const withRefs = skills.find((s) => s.name === "with-refs")!;
    assert.deepEqual(withRefs.references, { "references/schema.md": "the schema details\n" });
    const noRefs = skills.find((s) => s.name === "no-refs")!;
    assert.equal(noRefs.references, undefined); // absent, not an empty map
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
