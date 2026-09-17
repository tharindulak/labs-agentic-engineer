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
 * project/componentName now come straight from the caller's ae_create_issue
 * arguments — there is no separate identity channel to resolve them against.
 * See docs/design/draft/2026-09-17-sre-agent-extensions-handoff.md §2/§3.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { HANDOFF_LABELS, resolveHandoff } from "./handoffContext.js";

const ARGS = { project: "argproj", componentName: "argcomp", labels: ["needs-triage"], actionStatuses: ["revised"] };

test("project and componentName are taken straight from the arguments", () => {
  const resolved = resolveHandoff(ARGS, true);

  assert.equal(resolved.project, "argproj");
  assert.equal(resolved.componentName, "argcomp");
  assert.equal(resolved.dedupeKey, "sre-rca/argcomp");
});

test("no component means no dedupe key at all", () => {
  const resolved = resolveHandoff({ project: "argproj", actionStatuses: [] }, true);

  assert.equal(resolved.componentName, undefined);
  assert.equal(resolved.dedupeKey, undefined);
});

test("the handoff labels are added once, on top of the model's own", () => {
  const resolved = resolveHandoff({ project: "p", labels: ["bug", "mine"], actionStatuses: [] }, true);

  assert.deepEqual(resolved.labels, ["bug", "mine", "sre-agent"]);
  for (const label of HANDOFF_LABELS) assert.ok(resolved.labels.includes(label));
});

test("adoption is the operator's, carried through untouched", () => {
  assert.equal(resolveHandoff(ARGS, false).adopt, false);
  assert.equal(resolveHandoff(ARGS, true).adopt, true);
});

test("actionStatuses is carried through exactly, including nulls", () => {
  const resolved = resolveHandoff({ project: "p", actionStatuses: ["suggested", null, "revised"] }, true);
  assert.deepEqual(resolved.actionStatuses, ["suggested", null, "revised"]);
});

// aep-api's recurrence lookup queries GitHub with LabelSREAgent AND the dedupe
// label together (issue_service.go), so this copy has to keep matching that
// declaration exactly, not merely resemble it. Resolved relative to this file
// so the assertion holds regardless of where the suite is invoked from.
const LABEL_SRE_AGENT_SOURCE = fileURLToPath(
  new URL("../../aep-api/internal/sourcecontrol/issue_recurrence.go", import.meta.url),
);
const KIND_BUG_SOURCE = fileURLToPath(new URL("../../aep-api/internal/delivery/labels.go", import.meta.url));

function readGoConstant(path: string, name: string): string {
  const source = readFileSync(path, "utf8");
  const match = new RegExp(`${name}\\s*=\\s*"([^"]+)"`).exec(source);
  assert.ok(match, `could not find the ${name} declaration in ${path}`);
  const value = match?.[1];
  assert.ok(value, `the ${name} pattern matched but captured no value`);
  return value as string;
}

test("HANDOFF_LABELS is pinned, element for element and in order, to aep-api's label constants", () => {
  const kindBug = readGoConstant(KIND_BUG_SOURCE, "KindBug");
  const labelSREAgent = readGoConstant(LABEL_SRE_AGENT_SOURCE, "LabelSREAgent");

  assert.deepEqual(HANDOFF_LABELS, [kindBug, labelSREAgent]);
});
