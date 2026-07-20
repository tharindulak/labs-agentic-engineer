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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureThread, isValidThreadName, readSnapshot, reconcile, threadDir } from "./threads.js";

const NAME = "__pgtest";

function reset(): void {
  rmSync(threadDir(NAME), { recursive: true, force: true });
  ensureThread(NAME);
}

test("name validation rejects path escapes and conversation-id delimiters", () => {
  assert.ok(isValidThreadName("my-spec.1_v2"));
  // `--` is the namespaced conversation-id segment delimiter (§12); dot-led
  // names would be skipped by the snapshot walk.
  for (const bad of ["..", ".", "a/b", "a\\b", "a b", "", "my--spec", ".hidden"]) {
    assert.equal(isValidThreadName(bad), false);
  }
});

test("readSnapshot reads text recursively, skips dot-entries and binary", () => {
  reset();
  const root = threadDir(NAME);
  mkdirSync(join(root, "specs"), { recursive: true });
  writeFileSync(join(root, "specs", "a.md"), "hello\n");
  writeFileSync(join(root, ".secret"), "nope"); // dot-file → skipped
  writeFileSync(join(root, "img.bin"), Buffer.from([0x00, 0x01, 0x02])); // NUL → binary → skipped

  const snap = readSnapshot(NAME);
  assert.deepEqual(Object.keys(snap).sort(), ["specs/a.md"]);
  assert.equal(snap["specs/a.md"], "hello\n");
  rmSync(root, { recursive: true, force: true });
});

test("readSnapshot excludes derived artifacts (.excalidraw, *.gen.json) — agent never sees them", () => {
  reset();
  const root = threadDir(NAME);
  mkdirSync(join(root, "specs"), { recursive: true });
  writeFileSync(join(root, "specs", "wireframes.dsl"), "screen A\n");
  writeFileSync(join(root, "specs", "wireframes.excalidraw"), '{"type":"excalidraw"}');
  writeFileSync(join(root, "specs", "design.gen.json"), "{}");

  assert.deepEqual(Object.keys(readSnapshot(NAME)).sort(), ["specs/wireframes.dsl"]);
  rmSync(root, { recursive: true, force: true });
});

test("reconcile writes add/edit, deletes removed, and reports kinds", () => {
  reset();
  const before = { "keep.md": "x", "edit.md": "old", "gone.md": "bye" };
  for (const [p, c] of Object.entries(before)) writeFileSync(join(threadDir(NAME), p), c);

  const after = { "keep.md": "x", "edit.md": "new", "new.md": "fresh" }; // edit, add, drop gone.md
  const changes = reconcile(NAME, before, after, false);

  assert.deepEqual(
    changes.map((c) => `${c.kind} ${c.path}`).sort(),
    ["add new.md", "edit edit.md", "remove gone.md"],
  );
  assert.equal(readFileSync(join(threadDir(NAME), "edit.md"), "utf8"), "new");
  assert.equal(readFileSync(join(threadDir(NAME), "new.md"), "utf8"), "fresh");
  assert.equal(existsSync(join(threadDir(NAME), "gone.md")), false);
  rmSync(threadDir(NAME), { recursive: true, force: true });
});

test("reconcile dry-run reports changes but writes nothing", () => {
  reset();
  const changes = reconcile(NAME, {}, { "a.md": "1" }, true);
  assert.deepEqual(changes, [{ kind: "add", path: "a.md" }]);
  assert.equal(existsSync(join(threadDir(NAME), "a.md")), false);
  rmSync(threadDir(NAME), { recursive: true, force: true });
});

test("reconcile refuses a path that escapes the thread dir", () => {
  reset();
  assert.throws(() => reconcile(NAME, {}, { "../escape.txt": "pwn" }, false), /escapes the project directory/);
  rmSync(threadDir(NAME), { recursive: true, force: true });
});
