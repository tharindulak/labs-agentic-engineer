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
import { join } from "node:path";
import { expandProjectPath, PROJECTS_HOME, projectDirError, REPO_ROOT } from "../src/paths.js";

test("expandProjectPath: bare ~ and ~/ expand to home; relative paths resolve against the invocation dir", () => {
  const prevHome = process.env.HOME;
  const prevInit = process.env.INIT_CWD;
  process.env.HOME = "/tmp/fake-home";
  process.env.INIT_CWD = "/somewhere/else";
  try {
    assert.equal(expandProjectPath("~"), "/tmp/fake-home");
    assert.equal(expandProjectPath("~/apps/demo"), "/tmp/fake-home/apps/demo");
    assert.equal(expandProjectPath("rel/dir"), "/somewhere/else/rel/dir");
    assert.equal(expandProjectPath("/abs/dir"), "/abs/dir");
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevInit === undefined) delete process.env.INIT_CWD;
    else process.env.INIT_CWD = prevInit;
  }
});

test("projectDirError: repo interior refused, .projects subtree and outside dirs allowed", () => {
  assert.notEqual(projectDirError(join(REPO_ROOT, "playground")), null);
  assert.notEqual(projectDirError(PROJECTS_HOME), null, "the .projects root itself is not a project");
  assert.equal(projectDirError(join(PROJECTS_HOME, "my-app")), null);
  assert.equal(projectDirError("/tmp/anywhere/outside"), null);
});
