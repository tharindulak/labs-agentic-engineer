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

import assert from "node:assert/strict";
import { test } from "node:test";

import { type DeclineInput, validateDecline } from "./decline.js";

// A decline that satisfies the skill: every recommended action is accounted
// for, and each entry names the hardening change that was considered and why
// it would contradict the spec.
function justified(): DeclineInput {
  return {
    project: "demo",
    rootCause: "connection pool exhausted under the nightly export",
    ruledOut: [
      {
        action: "Raise the pool size for the export window",
        case: "config-actionable",
        why: "the remediation agent already expressed this as a ReleaseBinding change, so it is config, not code",
        hardeningRuledOut:
          "considered making the pool size adaptive in code; the spec fixes pool sizing as an operator concern, so moving it into the service would contradict it",
      },
    ],
  };
}

test("accepts a decline that accounts for the action and rules out hardening", () => {
  const res = validateDecline(justified());
  assert.equal(res.ok, true);
});

test("rejects a decline with no ruled-out entries", () => {
  const input = { ...justified(), ruledOut: [] };
  const res = validateDecline(input);
  assert.equal(res.ok, false);
  assert.match(res.error, /one entry per remaining action/i);
});

test("rejects an entry that does not name the hardening change considered", () => {
  const input = justified();
  input.ruledOut[0]!.hardeningRuledOut = "";
  const res = validateDecline(input);
  assert.equal(res.ok, false);
  assert.match(res.error, /hardeningRuledOut/);
});

test("rejects a stub justification", () => {
  const input = justified();
  input.ruledOut[0]!.hardeningRuledOut = "n/a";
  const res = validateDecline(input);
  assert.equal(res.ok, false);
  assert.match(res.error, /substantive/i);
});

// The regression this tool exists for: report 59796491 declined a deliberate
// 8s delay tripping a 5s timeout on the grounds that it was intended, which is
// the one test SKILL.md says is NOT the test.
test("rejects a justification that only asserts the behaviour was deliberate", () => {
  const input = justified();
  input.ruledOut[0]!.hardeningRuledOut = "This is intended behaviour, working as designed.";
  const res = validateDecline(input);
  assert.equal(res.ok, false);
  assert.match(res.error, /deliberate/i);
});

test("rejects an entry that does not name the action it rules out", () => {
  const input = justified();
  input.ruledOut[0]!.action = "   ";
  const res = validateDecline(input);
  assert.equal(res.ok, false);
  assert.match(res.error, /action/i);
});

test("names every offending entry by index so a multi-action decline is fixable in one pass", () => {
  const input = justified();
  input.ruledOut.push({
    action: "Remove the retry loop",
    case: "names-nothing-to-change",
    why: "",
    hardeningRuledOut: "",
  });
  const res = validateDecline(input);
  assert.equal(res.ok, false);
  assert.match(res.error, /\[1\]/);
});
