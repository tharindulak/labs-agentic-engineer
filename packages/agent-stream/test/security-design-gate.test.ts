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
 * Write-gate behavior for `specs/design/security.json`. These assert the zod
 * source of truth directly; the Go save-gate (internal/platform/securityspec)
 * validates the SAME published JSON Schema plus the same referential rules,
 * and has its own parity tests — a document that passes one gate MUST pass the
 * other.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkSecurityDesign } from "../src/security-design-schema.ts";
import { FileBundle } from "../src/bundle.ts";

const PATH = "specs/design/security.json";

/** A minimal valid security document (scopes omitted). */
function security(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    coldStartRole: "Viewer",
    publicComponents: [],
    roles: [
      {
        name: "Viewer",
        description: "Reads submitted claims.",
        stories: [1],
        grantedBy: "first sign-in",
        permissions: [{ component: "expense-api", actions: ["read own claims"] }],
      },
    ],
    testUsers: [{ username: "test-viewer", role: "Viewer" }],
    thunder: { name: "expense-app", type: "browser" },
    ...overrides,
  });
}

test("a well-formed document with thunder (scopes omitted) passes", () => {
  assert.equal(checkSecurityDesign(PATH, security()), null);
});

test("a well-formed document with scopes including group and ou passes", () => {
  assert.equal(
    checkSecurityDesign(
      PATH,
      security({ thunder: { name: "expense-app", type: "browser", scopes: "openid group ou" } }),
    ),
    null,
  );
});

test("the gate claims only specs/design/security.json", () => {
  assert.equal(checkSecurityDesign("specs/design/roles.json", "not json"), null);
  assert.equal(checkSecurityDesign("roles.json", "not json"), null);
  assert.equal(checkSecurityDesign("specs/design/components/api/roles.json", "not json"), null);
});

test("unparseable JSON is INVALID_JSON", () => {
  const problem = checkSecurityDesign(PATH, "{");
  assert.equal(problem?.code, "INVALID_JSON");
});

test("an unknown property is rejected — no secret can be smuggled in", () => {
  const problem = checkSecurityDesign(
    PATH,
    security({
      testUsers: [{ username: "test-viewer", role: "Viewer", password: "hunter2" }],
    }),
  );
  assert.equal(problem?.code, "SCHEMA_VIOLATION");
  assert.match(problem!.message, /password/);
});

test("thunder.type other than browser is SCHEMA_VIOLATION", () => {
  const problem = checkSecurityDesign(
    PATH,
    security({ thunder: { name: "expense-app", type: "spa" } }),
  );
  assert.equal(problem?.code, "SCHEMA_VIOLATION");
});

test("scopes without group is SCHEMA_VIOLATION", () => {
  const problem = checkSecurityDesign(
    PATH,
    security({ thunder: { name: "expense-app", type: "browser", scopes: "openid ou" } }),
  );
  assert.equal(problem?.code, "SCHEMA_VIOLATION");
});

test("scopes without ou is SCHEMA_VIOLATION", () => {
  const problem = checkSecurityDesign(
    PATH,
    security({ thunder: { name: "expense-app", type: "browser", scopes: "openid group" } }),
  );
  assert.equal(problem?.code, "SCHEMA_VIOLATION");
});

test("omit scopes parses", () => {
  assert.equal(checkSecurityDesign(PATH, security()), null);
});

test("a version other than 1 is rejected", () => {
  assert.equal(checkSecurityDesign(PATH, security({ version: 2 }))?.code, "SCHEMA_VIOLATION");
});

test("at least one role is required", () => {
  assert.equal(
    checkSecurityDesign(PATH, security({ roles: [], testUsers: [], coldStartRole: null }))?.code,
    "SCHEMA_VIOLATION",
  );
});

test("a test user naming an undeclared role is rejected", () => {
  const problem = checkSecurityDesign(PATH, security({ testUsers: [{ username: "test-admin", role: "Admin" }] }));
  assert.equal(problem?.code, "SCHEMA_VIOLATION");
  assert.match(problem!.message, /no roles\[\] entry declares/);
});

test("a coldStartRole naming an undeclared role is rejected", () => {
  const problem = checkSecurityDesign(PATH, security({ coldStartRole: "Nobody" }));
  assert.match(problem!.message, /not a declared role/);
});

test("coldStartRole may be null", () => {
  assert.equal(checkSecurityDesign(PATH, security({ coldStartRole: null })), null);
});

test("a duplicate role name is rejected, case-insensitively", () => {
  const problem = checkSecurityDesign(
    PATH,
    security({
      roles: [
        {
          name: "Viewer",
          description: "a",
          stories: [1],
          grantedBy: "first sign-in",
          permissions: [{ component: "api", actions: ["read"] }],
        },
        {
          name: "viewer",
          description: "b",
          stories: [2],
          grantedBy: "Viewer",
          permissions: [{ component: "api", actions: ["read"] }],
        },
      ],
    }),
  );
  assert.match(problem!.message, /declared twice/);
});

test("a permission granting neither actions nor screens is rejected", () => {
  const problem = checkSecurityDesign(
    PATH,
    security({
      roles: [
        {
          name: "Viewer",
          description: "a",
          stories: [1],
          grantedBy: "first sign-in",
          permissions: [{ component: "api" }],
        },
      ],
    }),
  );
  assert.match(problem!.message, /grants nothing/);
});

test("a username the directory cannot hold is rejected", () => {
  const problem = checkSecurityDesign(PATH, security({ testUsers: [{ username: "Test Viewer", role: "Viewer" }] }));
  assert.match(problem!.message, /usable directory username/);
});

test("a duplicate username is rejected", () => {
  const problem = checkSecurityDesign(
    PATH,
    security({
      testUsers: [
        { username: "test-viewer", role: "Viewer" },
        { username: "test-viewer", role: "Viewer" },
      ],
    }),
  );
  assert.match(problem!.message, /listed twice/);
});

test("an empty testUsers list passes the gate — the build supplies the missing users", () => {
  assert.equal(checkSecurityDesign(PATH, security({ testUsers: [] })), null);
});

test("the FileBundle refuses a bad security.json and stays byte-for-byte unchanged", () => {
  const bundle = new FileBundle({ [PATH]: security() });
  const before = bundle.snapshot()[PATH];
  const res = bundle.editFile(PATH, '"version":1', '"version":9');
  assert.equal(res.ok, false);
  if (res.ok) throw new Error("expected rejection");
  assert.equal(res.code, "SCHEMA_VIOLATION");
  assert.equal(bundle.snapshot()[PATH], before);
});