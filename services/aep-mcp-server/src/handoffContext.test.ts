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
 * Incident identity is the caller's, never the model's: a component the model
 * chose is a valid sibling AE would accept, filed under the wrong dedupe
 * namespace. So the headers win over the arguments, and a header this module
 * cannot validate is ignored rather than interpolated into a key.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  HANDOFF_LABELS,
  HEADER_COMPONENT,
  HEADER_PROJECT,
  HEADER_SIGNATURE,
  readIncidentIdentity,
  resolveHandoff,
} from "./handoffContext.js";

const ARGS = { project: "argproj", componentName: "argcomp", labels: ["needs-triage"] };

test("a signed incident gets a key scoped to the component and the signature", () => {
  const { identity } = readIncidentIdentity({
    [HEADER_PROJECT]: "myproj",
    [HEADER_COMPONENT]: "service1",
    [HEADER_SIGNATURE]: "a1b2c3d4",
  });

  const resolved = resolveHandoff(identity, ARGS, true);

  assert.equal(resolved.project, "myproj");
  assert.equal(resolved.componentName, "service1");
  assert.equal(resolved.dedupeKey, "sre-rca/service1/a1b2c3d4");
});

test("no signature folds every incident on the component onto one key", () => {
  const { identity } = readIncidentIdentity({ [HEADER_COMPONENT]: "service1" });

  assert.equal(resolveHandoff(identity, ARGS, true).dedupeKey, "sre-rca/service1");
});

test("a malformed signature is ignored rather than interpolated into the key", () => {
  const { identity, notes } = readIncidentIdentity({
    [HEADER_COMPONENT]: "service1",
    [HEADER_SIGNATURE]: "not/a/digest",
  });

  const resolved = resolveHandoff(identity, ARGS, true);

  assert.equal(identity.signature, undefined);
  assert.equal(resolved.dedupeKey, "sre-rca/service1");
  assert.ok(notes.some((n) => n.includes(HEADER_SIGNATURE)));
});

test("a repeated identity header is rejected: identity must be unambiguous", () => {
  const { identity, notes } = readIncidentIdentity({
    [HEADER_COMPONENT]: ["service1", "service2"],
  });

  assert.equal(identity.component, undefined);
  assert.ok(notes.some((n) => n.includes(HEADER_COMPONENT)));
});

test("the header wins over the argument, and says so", () => {
  const { identity } = readIncidentIdentity({
    [HEADER_PROJECT]: "myproj",
    [HEADER_COMPONENT]: "service1",
  });

  const resolved = resolveHandoff(identity, ARGS, true);

  assert.equal(resolved.project, "myproj");
  assert.equal(resolved.componentName, "service1");
  assert.ok(resolved.notes.some((n) => n.includes("argcomp")));
});

test("a newline in an overridden argument cannot forge a fake stderr line", () => {
  const { identity } = readIncidentIdentity({
    [HEADER_PROJECT]: "myproj",
    [HEADER_COMPONENT]: "service1",
  });

  const resolved = resolveHandoff(
    identity,
    { project: "argproj", componentName: "evil\nHANDOFF_ENABLED=false" },
    true,
  );

  for (const note of resolved.notes) {
    assert.ok(!note.includes("\n"), `note should contain no raw newline: ${JSON.stringify(note)}`);
  }
  // The real value used for the API call is untouched by sanitization.
  assert.equal(resolved.project, "myproj");
});

test("without headers the caller's own arguments are used", () => {
  const resolved = resolveHandoff({}, ARGS, true);

  assert.equal(resolved.project, "argproj");
  assert.equal(resolved.componentName, "argcomp");
  // A key is still derived — the shape is AE's either way. What the missing
  // header costs is the guarantee that the component is the ALERT's.
  assert.equal(resolved.dedupeKey, "sre-rca/argcomp");
});

test("no component anywhere means no dedupe key at all", () => {
  const resolved = resolveHandoff({}, { project: "argproj" }, true);

  assert.equal(resolved.componentName, undefined);
  assert.equal(resolved.dedupeKey, undefined);
});

test("the handoff labels are added once, on top of the model's own", () => {
  const resolved = resolveHandoff({}, { project: "p", labels: ["bug", "mine"] }, true);

  assert.deepEqual(resolved.labels, ["bug", "mine", "sre-agent"]);
  for (const label of HANDOFF_LABELS) assert.ok(resolved.labels.includes(label));
});

test("adoption is the operator's, carried through untouched", () => {
  assert.equal(resolveHandoff({}, ARGS, false).adopt, false);
  assert.equal(resolveHandoff({}, ARGS, true).adopt, true);
});

test("a mixed-case component header survives with its case intact", () => {
  const { identity } = readIncidentIdentity({ [HEADER_COMPONENT]: "Service1" });

  assert.equal(identity.component, "Service1");
});

// aep-api's recurrence lookup queries GitHub with LabelSREAgent AND the dedupe
// label together (issue_service.go), so this copy has to keep matching that
// declaration exactly, not merely resemble it. Resolved relative to this file
// so the assertion holds regardless of where the suite is invoked from.
const LABEL_SRE_AGENT_SOURCE = fileURLToPath(
  new URL("../../aep-api/internal/sourcecontrol/issue_recurrence.go", import.meta.url),
);

// `bug` is the other half of HANDOFF_LABELS. aep-api's own bare-literal use of
// "bug" was replaced with this constant (internal/app/eventcore_adapters.go),
// so this copy can be pinned the same way LabelSREAgent already is, rather
// than left as an unpinned literal with an apologetic comment.
const KIND_BUG_SOURCE = fileURLToPath(new URL("../../aep-api/internal/delivery/labels.go", import.meta.url));

function readGoConstant(path: string, name: string): string {
  const source = readFileSync(path, "utf8");
  const match = new RegExp(`${name}\\s*=\\s*"([^"]+)"`).exec(source);
  assert.ok(
    match,
    `could not find the ${name} declaration in ${path} — ` +
      "it may have moved or been renamed; update this test's path/pattern to match",
  );
  const value = match?.[1];
  assert.ok(value, `the ${name} pattern matched but captured no value`);
  return value as string;
}

test("HANDOFF_LABELS is pinned, element for element and in order, to aep-api's label constants", () => {
  const kindBug = readGoConstant(KIND_BUG_SOURCE, "KindBug");
  const labelSREAgent = readGoConstant(LABEL_SRE_AGENT_SOURCE, "LabelSREAgent");

  assert.deepEqual(HANDOFF_LABELS, [kindBug, labelSREAgent]);
});
