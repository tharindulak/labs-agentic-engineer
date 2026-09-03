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
 * Two properties matter here and neither is about wiring. The model must not be
 * able to name the dedupe key or the adoption flag — they are not in the schema
 * it reads. And the project it passes must not be able to reach a sibling
 * project when the caller's process said which project this incident is on.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createAepMcpServer } from "./server.js";
import { HEADER_COMPONENT, HEADER_PROJECT, HEADER_SIGNATURE, readIncidentIdentity } from "./handoffContext.js";

// _registeredTools is the SDK's own registry; reading it keeps these tests on
// what the model is actually shown/does rather than on a copy of it. Two
// deviations from the brief's sketch, both forced by the installed SDK
// (@modelcontextprotocol/sdk@1.29.0): `inputSchema` is stored as a ZodObject
// wrapping the raw shape (its own enumerable keys are the ZodObject's
// internals, not the field names), so the field names come from `.shape`;
// and the registered handler lives under `.handler`, not `.callback`.
interface RegisteredTool {
  inputSchema: { shape: Record<string, unknown> };
  handler: (args: unknown) => unknown;
}

function toolSchema(name: string): Record<string, unknown> {
  const server = createAepMcpServer(
    { baseUrl: "http://aep-api", bearer: "Bearer t" },
    { identity: {}, adopt: true },
  );
  const registered = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
  return registered[name]!.inputSchema.shape;
}

test("the model is never shown the dedupe key or the adoption flag", () => {
  const schema = toolSchema("ae_create_issue");

  assert.equal("dedupeKey" in schema, false);
  assert.equal("adopt" in schema, false);
  // Still present as fallbacks for a caller that sends no identity headers.
  assert.equal("componentName" in schema, true);
  assert.equal("project" in schema, true);
});

test("identity headers resolve to the values aep-api is sent", async () => {
  const { identity } = readIncidentIdentity({
    [HEADER_PROJECT]: "myproj",
    [HEADER_COMPONENT]: "service1",
    [HEADER_SIGNATURE]: "a1b2c3",
  });
  const seen: unknown[] = [];
  const server = createAepMcpServer(
    { baseUrl: "http://aep-api", bearer: "Bearer t" },
    { identity, adopt: false },
    // Injected create function: the point under test is what this server
    // DERIVES, not that fetch works.
    async (_opts, project, req) => {
      seen.push({ project, req });
      return { number: 1, url: "u", nodeId: "n" };
    },
  );
  const registered = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
  const handler = registered["ae_create_issue"]!.handler;

  await handler({ project: "wrongproj", title: "t", body: "b", labels: ["mine"] });

  assert.deepEqual(seen, [
    {
      project: "myproj",
      req: {
        title: "t",
        body: "b",
        labels: ["mine", "bug", "sre-agent"],
        componentName: "service1",
        dedupeKey: "sre-rca/service1/a1b2c3",
        adopt: false,
      },
    },
  ]);
});
