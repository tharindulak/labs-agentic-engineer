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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { materializeSkills, rewriteSkillFrontmatter, type SkillResolution } from "./skills_materializer.js";

async function tmpWorkspace(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), "aep-materializer-test-"));
}

const skillMD = `---\nname: demo\ndescription: does demo things.\n---\n\n# demo\n`;

// fixtureResolution builds a SkillResolution carrying the full standard
// structure: a markdown reference, an executable script, and a binary asset —
// plus a path-traversal key that must be dropped by the safety guard.
function fixtureResolution(): SkillResolution {
  return {
    materializedName: "org-demo",
    kind: "org",
    skillMd: skillMD,
    references: {
      "references/a.md": Buffer.from("# ref a", "utf-8"),
      "scripts/run.mjs": Buffer.from("console.log('hi');\n", "utf-8"),
      "assets/tpl.ts": Buffer.from("export const x = 1;\n", "utf-8"),
      "../escape": Buffer.from("nope", "utf-8"),
    },
  };
}

test("materializeSkills writes the full structure with exec-bit scripts", async () => {
  const ws = await tmpWorkspace();
  const out = await materializeSkills(ws, [fixtureResolution()]);
  assert.ok(out);
  const skillDir = path.join(out!.pluginDir, "skills", "org-demo");

  assert.ok(fs.existsSync(path.join(skillDir, "assets", "tpl.ts")));

  const scriptMode = fs.statSync(path.join(skillDir, "scripts", "run.mjs")).mode & 0o777;
  assert.equal(scriptMode, 0o755);
});

test("materializeSkills keeps non-script files at 0o644", async () => {
  const ws = await tmpWorkspace();
  const out = await materializeSkills(ws, [fixtureResolution()]);
  const skillDir = path.join(out!.pluginDir, "skills", "org-demo");

  const refMode = fs.statSync(path.join(skillDir, "references", "a.md")).mode & 0o777;
  assert.equal(refMode, 0o644);
  const assetMode = fs.statSync(path.join(skillDir, "assets", "tpl.ts")).mode & 0o777;
  assert.equal(assetMode, 0o644);
});

test("materializeSkills skips path-traversal and absolute keys", async () => {
  const ws = await tmpWorkspace();
  const out = await materializeSkills(ws, [fixtureResolution()]);
  const skillDir = path.join(out!.pluginDir, "skills", "org-demo");

  assert.ok(!fs.existsSync(path.join(ws, ".aep", "escape")));
  // Nothing escaped the skill dir into the plugin root either.
  assert.deepEqual(fs.readdirSync(skillDir).sort(), ["SKILL.md", "assets", "references", "scripts"]);
});

test("materializeSkills writes buffers byte-faithfully (binary content untouched)", async () => {
  const ws = await tmpWorkspace();
  const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
  const resolution: SkillResolution = {
    materializedName: "org-demo",
    kind: "org",
    skillMd: skillMD,
    references: { "assets/logo.png": binary },
  };
  const out = await materializeSkills(ws, [resolution]);
  const written = fs.readFileSync(path.join(out!.pluginDir, "skills", "org-demo", "assets", "logo.png"));
  assert.ok(Buffer.compare(written, binary) === 0);
});

test("rewriteSkillFrontmatter still rewrites name and canonical-name (unaffected by aux file changes)", () => {
  const rewritten = rewriteSkillFrontmatter(skillMD, "org-demo");
  assert.match(rewritten, /name: org-demo/);
  assert.match(rewritten, /canonical-name: "demo"/);
});
