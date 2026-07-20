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

/** Coding-run flow units: status write-back, undo round trip, gates, timeline. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readDerivedStatus, renderProgressLine, writeDerivedStatus } from "../src/engine/coding-run.js";
import { renderTaskContextFile } from "../src/ports/issue-store.js";
import { takeUndoSnapshot, restoreUndoSnapshot, listUndoSnapshots } from "../src/state/undo.js";
import { codeCommand } from "../src/commands.js";

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "aep-play-code-"));
  mkdirSync(join(dir, "issues"), { recursive: true });
  writeFileSync(
    join(dir, "issues", "3.md"),
    renderTaskContextFile({
      issueNumber: 3,
      component: "user-service",
      title: "Implement the user service",
      dependsOn: ["auth-service"],
      derivedStatus: "ready",
      body: "scope",
    }),
  );
  return dir;
}

test("writeDerivedStatus replaces an existing value and inserts a missing one", () => {
  const dir = tempProject();
  try {
    writeDerivedStatus(dir, "issues/3.md", "running");
    assert.match(readFileSync(join(dir, "issues/3.md"), "utf8"), /derivedStatus: "running"/);

    // A file without the field gets it inserted after origin (production order).
    writeFileSync(join(dir, "issues", "4.md"), '---\nissueNumber: 4\ncomponent: "a"\ntitle: "T"\ndependsOn: []\norigin: "manual"\n---\n');
    writeDerivedStatus(dir, "issues/4.md", "deployed");
    const text = readFileSync(join(dir, "issues/4.md"), "utf8");
    assert.match(text, /origin: "manual"\nderivedStatus: "deployed"\n---/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("undo snapshot + restore round-trips edits and removes new files", () => {
  const dir = tempProject();
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "main.go"), "package main\n");
    const snap = takeUndoSnapshot(dir);
    assert.ok(existsSync(snap));
    assert.equal(listUndoSnapshots(dir)[0], snap);

    // Agent damage: edit a file, add a new one, delete another.
    writeFileSync(join(dir, "src", "main.go"), "package broken\n");
    writeFileSync(join(dir, "src", "junk.go"), "junk\n");
    rmSync(join(dir, "issues", "3.md"));

    const restored = restoreUndoSnapshot(dir);
    assert.equal(restored, snap);
    assert.equal(readFileSync(join(dir, "src", "main.go"), "utf8"), "package main\n");
    assert.ok(!existsSync(join(dir, "src", "junk.go")), "post-snapshot file removed");
    assert.ok(existsSync(join(dir, "issues", "3.md")), "deleted file restored");
    // The state dir itself is never part of the snapshot scope.
    assert.ok(existsSync(join(dir, ".aep-playground", "undo")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("codeCommand gates: unparseable issue fails; unconfirmed headless run fails before any snapshot", async () => {
  const dir = tempProject();
  try {
    const bad = await codeCommand(dir, "issues/99.md", { silent: true });
    assert.equal(bad.ok, false);
    assert.match(bad.detail ?? "", /does not parse/);

    const unconfirmed = await codeCommand(dir, "issues/3.md", { silent: true });
    assert.equal(unconfirmed.ok, false);
    assert.match(unconfirmed.detail ?? "", /not confirmed/);
    assert.equal(listUndoSnapshots(dir).length, 0, "no snapshot before consent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readDerivedStatus reads the frontmatter value (the exit-0 clobber guard's input)", () => {
  const dir = tempProject();
  try {
    assert.equal(readDerivedStatus(dir, "issues/3.md"), "ready");
    // The agent's give-up protocol sets "failed" and exits 0 — the settle
    // logic must see this value and NOT normalize it to deployed.
    writeDerivedStatus(dir, "issues/3.md", "failed");
    assert.equal(readDerivedStatus(dir, "issues/3.md"), "failed");
    assert.equal(readDerivedStatus(dir, "issues/404.md"), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderProgressLine maps the NDJSON vocabulary to timeline lines", () => {
  assert.equal(renderProgressLine({ kind: "phase", phase: "workspace_ready" }), "  ▸ workspace ready");
  assert.equal(renderProgressLine({ kind: "tool_use", tool: "Bash", summary: "go test ./..." }), "  $ go test ./...");
  assert.match(renderProgressLine({ kind: "result", status: "success" }), /result success/);
  assert.match(renderProgressLine({ kind: "result", status: "failure", error: "boom" }), /failure — boom/);
  assert.match(renderProgressLine({ kind: "gh_action", command: "pr create" }), /local mode has no GitHub/);
});
