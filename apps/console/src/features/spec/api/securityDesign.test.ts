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

import { describe, expect, it } from "vitest";

import {
  parseSecurityDesign,
  plannedUsersFor,
  planUsers,
  roleSlug,
  serializeSecurityDesign,
  suppliedUsernameFor,
  type SecurityDesign,
} from "./securityDesign";

type Role = SecurityDesign["roles"][number];

function role(name: string): Role {
  return {
    name,
    description: `What ${name} may do`,
    stories: [1],
    grantedBy: "an administrator",
    permissions: [{ component: "orders-api", actions: ["read"] }],
  };
}

function doc(over: Partial<SecurityDesign> = {}): SecurityDesign {
  return {
    version: 1,
    coldStartRole: null,
    publicComponents: [],
    roles: [role("Admin"), role("Viewer")],
    testUsers: [],
    thunder: { name: "orders-app", type: "browser" },
    ...over,
  };
}

/** Fully populated document for parse and planUsers round-trip tests. */
function richDoc(): SecurityDesign {
  return {
    version: 1,
    coldStartRole: "Viewer",
    publicComponents: ["storefront-webapp", "docs-site"],
    roles: [role("Admin"), role("Viewer")],
    testUsers: [{ username: "test-admin", role: "Admin" }],
    thunder: { name: "orders-app", type: "browser" },
  };
}

describe("parseSecurityDesign", () => {
  // A design with no sign-in legitimately has no security document. "Empty" is a
  // state the panel puts into words; "invalid" is an error it shows in red.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["whitespace only", "  \n\t  "],
  ])("reads %s as empty rather than as a failure", (_label, text) => {
    expect(parseSecurityDesign(text)).toEqual({ kind: "empty" });
  });

  it("reports malformed JSON as invalid", () => {
    const parsed = parseSecurityDesign('{"version": 1,');
    expect(parsed.kind).toBe("invalid");
    if (parsed.kind !== "invalid") throw new Error("unreachable");
    expect(parsed.message).not.toBe("");
  });

  it.each([
    ["empty object", "{}"],
    ["JSON array", "[]"],
  ])("reads %s as empty rather than as a failure", (_label, text) => {
    expect(parseSecurityDesign(text)).toEqual({ kind: "empty" });
  });

  it("reads well-formed JSON missing required fields as empty", () => {
    const bad = {
      ...doc(),
      roles: [{ ...role("Admin"), description: undefined }],
    };
    expect(parseSecurityDesign(JSON.stringify(bad))).toEqual({ kind: "empty" });
  });

  // The schema is strict, but an unknown key means incomplete, not unparseable.
  it("reads an unknown top-level key as empty", () => {
    const parsed = parseSecurityDesign(
      JSON.stringify({ ...doc(), password: "hunter2" }),
    );
    expect(parsed).toEqual({ kind: "empty" });
  });

  it("accepts a well-formed document and hands back the parsed shape", () => {
    const good = richDoc();
    const parsed = parseSecurityDesign(serializeSecurityDesign(good));
    expect(parsed).toEqual({ kind: "ok", doc: good });
  });

  it("accepts thunder without scopes", () => {
    const good = doc({ thunder: { name: "orders-app", type: "browser" } });
    const parsed = parseSecurityDesign(serializeSecurityDesign(good));
    expect(parsed).toEqual({ kind: "ok", doc: good });
  });
});

describe("plannedUsersFor", () => {
  it("returns the authored users of a role, none of them supplied", () => {
    const d = doc({
      testUsers: [
        { username: "ada", role: "Admin" },
        { username: "grace", role: "Admin" },
        { username: "vera", role: "Viewer" },
      ],
    });
    expect(plannedUsersFor(d, "Admin")).toEqual([
      { username: "ada", role: "Admin", supplied: false },
      { username: "grace", role: "Admin", supplied: false },
    ]);
  });

  it("gives a role with no authored user exactly one supplied test-<slug>", () => {
    const d = doc({ testUsers: [{ username: "ada", role: "Admin" }] });
    expect(plannedUsersFor(d, "Viewer")).toEqual([
      { username: "test-viewer", role: "Viewer", supplied: true },
    ]);
  });

  it("matches a test user to its role case-insensitively", () => {
    const d = doc({ testUsers: [{ username: "ada", role: "aDmIn" }] });
    expect(plannedUsersFor(d, "Admin")).toEqual([
      { username: "ada", role: "Admin", supplied: false },
    ]);
    // …and the lookup itself is case-insensitive from either side.
    expect(plannedUsersFor(d, "ADMIN")).toEqual([
      { username: "ada", role: "Admin", supplied: false },
    ]);
  });
});

describe("roleSlug", () => {
  it.each([
    ["Compliance Admin", "compliance-admin"],
    ["Ops/Support", "ops-support"],
    ["  Spaced  Name  ", "spaced-name"],
    ["ADMIN", "admin"],
    ["a--b", "a-b"],
  ])("slugs %j into %j", (name, expected) => {
    expect(roleSlug(name)).toBe(expected);
  });

  // A username must start with a letter or digit, so an empty slug cannot be
  // allowed to produce the bare "test-".
  it('falls back to "role" for a name that slugs to nothing', () => {
    expect(roleSlug("!!!")).toBe("role");
    expect(roleSlug("   ")).toBe("role");
    expect(suppliedUsernameFor(doc({ roles: [role("!!!")] }), "!!!")).toBe(
      "test-role",
    );
  });
});

describe("suppliedUsernameFor", () => {
  it("builds the name from the role slug", () => {
    const d = doc({ roles: [role("Compliance Admin"), role("Ops/Support")] });
    expect(suppliedUsernameFor(d, "Compliance Admin")).toBe(
      "test-compliance-admin",
    );
    expect(suppliedUsernameFor(d, "Ops/Support")).toBe("test-ops-support");
  });
});

/**
 * The panel promises the user a name before Build runs, and the build has to
 * produce that same name. The generator therefore exists twice — here and as
 * `securityspec.supplyUsername` in `services/aep-api/internal/platform/securityspec`
 * — and the two disagreeing is a real defect, not a cosmetic one: the panel
 * would show a login that never appears.
 *
 * The expectations below are the OBSERVED output of the Go `securityspec.Plan`
 * for the same documents, transcribed. Change one side and this goes red.
 */
describe("suppliedUsernameFor agrees with the Go build's securityspec.supplyUsername", () => {
  // Two DISTINCT role names that slug identically. The schema's uniqueness rule
  // is on the NAME, so this document is legal, and the Go build resolves it by
  // adding each generated name to its taken set as it mints it. A TS generator
  // that only consulted the AUTHORED users would promise both roles
  // `test-ops-support` while the build actually created `-support` and
  // `-support-2` — one role would show a login that never gets created.
  it("suffixes the second of two roles whose names slug identically, as Go does", () => {
    const d = doc({
      roles: [role("Ops Support"), role("Ops/Support")],
      testUsers: [],
      coldStartRole: null,
    });
    expect(planUsers(d).map((u) => u.username)).toEqual([
      "test-ops-support",
      "test-ops-support-2",
    ]);
    expect(suppliedUsernameFor(d, "Ops/Support")).toBe("test-ops-support-2");
  });

  it("suffixes the role ordinal when an authored user of ANOTHER role holds the natural name", () => {
    // Go: Plan → [{test-viewer Admin} {test-viewer-2 Viewer supplied}]
    const d = doc({ testUsers: [{ username: "test-viewer", role: "Admin" }] });
    expect(suppliedUsernameFor(d, "Viewer")).toBe("test-viewer-2");
  });

  it("uses ordinal+1, so the first declared role suffixes -1 and not -0", () => {
    // Go: Plan → [{test-admin-1 Admin supplied} {test-admin Viewer}]
    const d = doc({ testUsers: [{ username: "test-admin", role: "Viewer" }] });
    expect(suppliedUsernameFor(d, "Admin")).toBe("test-admin-1");
  });

  it("leaves the natural name alone when nothing has taken it", () => {
    // Go: Plan → [{test-compliance-admin …} {test-ops-support …}]
    const d = doc({ roles: [role("Compliance Admin"), role("Ops/Support")] });
    expect(suppliedUsernameFor(d, "Compliance Admin")).toBe(
      "test-compliance-admin",
    );
    expect(suppliedUsernameFor(d, "Ops/Support")).toBe("test-ops-support");
  });

  it("is unaffected by the case a test user spells its role in", () => {
    // Go: Plan → [{alice Admin}] — the authored user satisfies the role, so
    // nothing is supplied at all.
    const d = doc({
      roles: [role("Admin")],
      testUsers: [{ username: "alice", role: "admin" }],
    });
    expect(plannedUsersFor(d, "Admin")).toEqual([
      { username: "alice", role: "Admin", supplied: false },
    ]);
  });
});
