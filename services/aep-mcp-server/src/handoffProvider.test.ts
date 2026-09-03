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
 * The handoff provider descriptor is AEP's vocabulary, shipped to the SRE agent
 * so that agent holds none of our names. These tests pin its tool names against
 * what server.ts actually registers, and its incident-header names against what
 * handoffContext.ts actually reads — two independent artifacts that must agree,
 * where a drift is otherwise silent.
 *
 * Why here and not in the agent's suite: the agent validates the descriptor's
 * SHAPE, which is its business, but only this repo knows whether the names in it
 * are the ones `ae_create_issue` really answers to. A test in the OpenChoreo
 * repo asserting AEP's field names would be the coupling this descriptor exists
 * to remove.
 *
 * The failure it catches is silent by nature. Rename a tool in server.ts
 * without editing the descriptor and nothing breaks loudly — the SRE agent
 * keeps calling the old name, and every handoff fails.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { HEADER_COMPONENT, HEADER_PROJECT, HEADER_SIGNATURE } from "./handoffContext.js";

const descriptor = JSON.parse(
  readFileSync(new URL("../handoff/provider.json", import.meta.url), "utf8"),
) as Record<string, any>;

const serverSrc = readFileSync(
  fileURLToPath(new URL("./server.ts", import.meta.url)),
  "utf8",
);

test("the incident headers the descriptor names are the ones handoffContext.ts reads", () => {
  // HTTP header names are case-insensitive and Node lower-cases them on
  // receipt, so the comparison folds case. A drift here is silent: the header
  // still arrives, but handoffContext.ts no longer recognises it under the
  // name the descriptor advertises, and the incident quietly falls back to
  // whatever the tool call argued.
  const wired: Record<string, string> = {
    project: HEADER_PROJECT,
    component: HEADER_COMPONENT,
    signature: HEADER_SIGNATURE,
  };
  for (const [key, header] of Object.entries(wired)) {
    assert.equal(
      (descriptor["incident_headers"][key] as string).toLowerCase(),
      header,
      `descriptor incident_headers.${key} does not match handoffContext.ts`,
    );
  }
});

test("the answer fields the agent reads are ones aep-api returns", () => {
  const answers = descriptor["answer_fields"];
  // number/url/deduped are the three the agent acts on; the rest ride along in
  // provider_facts and only need to be real.
  for (const key of ["issue_number", "issue_url", "already_filed"]) {
    assert.equal(typeof answers[key], "string", `answer_fields.${key} must be a string`);
  }
  assert.ok(Array.isArray(answers["facts"]), "answer_fields.facts must be a list");
});

test("the descriptor's tool names are exactly the ones server.ts registers", () => {
  // Same shape as the incident-headers cross-check above: two independent,
  // hand-maintained artifacts that must agree, where a drift is silent.
  // Rename a tool in server.ts without updating the descriptor and nothing
  // throws — the mounted descriptor still tells the SRE agent to call the old
  // name, and every handoff fails calling a tool that no longer exists.
  const registered = [...serverSrc.matchAll(/registerTool\(\s*\n?\s*"([^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.ok(
    registered.length > 0,
    "found no registerTool(\"...\") calls in server.ts — the pattern this test matches on " +
      "may have moved; update the regex rather than letting this pass silently",
  );

  const described = [descriptor["tools"]["create_issue"], descriptor["tools"]["search_related"]];

  for (const tool of described) {
    assert.ok(
      registered.includes(tool),
      `descriptor names tool "${tool}", which server.ts does not register ` +
        `(server.ts has: ${registered.join(", ")}) — the descriptor is stale`,
    );
  }
  for (const tool of registered) {
    assert.ok(
      described.includes(tool),
      `server.ts registers tool "${tool}", which the descriptor does not name ` +
        `(descriptor has: ${described.join(", ")}) — the descriptor is stale`,
    );
  }
});

test("the descriptor carries no fields the agent is meant to decide", () => {
  // A descriptor renames things. It must never grow a knob that changes what the
  // handoff concludes — that judgment is the agent's, and moving it here would
  // put AEP in charge of another repo's decisions.
  const allowed = new Set(["tools", "incident_headers", "answer_fields"]);
  const unexpected = Object.keys(descriptor).filter(
    (k) => !k.startsWith("_") && !allowed.has(k),
  );
  assert.deepEqual(unexpected, [], `unexpected descriptor keys: ${unexpected.join(", ")}`);
});
