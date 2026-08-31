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
import type { ProjectTestUserState } from "../../spec/api/roles";
import { publishedTestUsers } from "./publishedTestUsers";

function user(
  over: Partial<ProjectTestUserState> &
    Pick<ProjectTestUserState, "username" | "roleName" | "owned">,
): ProjectTestUserState {
  return {
    supplied: false,
    coldStart: false,
    exists: true,
    rotatedAt: null,
    referencingProjects: null,
    referencingCount: 1,
    ...over,
  };
}

describe("publishedTestUsers", () => {
  it("includes owned users with username, role, and coldStart", () => {
    expect(
      publishedTestUsers([
        user({
          username: "test-viewer",
          roleName: "Viewer",
          owned: true,
          exists: true,
          coldStart: true,
        }),
      ]),
    ).toEqual([
      { username: "test-viewer", role: "Viewer", coldStart: true },
    ]);
  });

  it("includes owned: true even when exists is false", () => {
    expect(
      publishedTestUsers([
        user({
          username: "test-viewer",
          roleName: "Viewer",
          owned: true,
          exists: false,
        }),
      ]),
    ).toEqual([{ username: "test-viewer", role: "Viewer", coldStart: false }]);
  });

  it("omits owned: false (taken username / not ours)", () => {
    expect(
      publishedTestUsers([
        user({
          username: "jsmith",
          roleName: "Compliance Admin",
          owned: false,
          exists: true,
        }),
      ]),
    ).toEqual([]);
  });

  it("omits owned: false, exists: false (gate has not published)", () => {
    expect(
      publishedTestUsers([
        user({
          username: "test-viewer",
          roleName: "Viewer",
          owned: false,
          exists: false,
          coldStart: true,
        }),
      ]),
    ).toEqual([]);
  });

  it("keeps only owned rows and preserves order", () => {
    expect(
      publishedTestUsers([
        user({
          username: "first-owned",
          roleName: "Viewer",
          owned: true,
        }),
        user({
          username: "not-ours",
          roleName: "Admin",
          owned: false,
        }),
        user({
          username: "second-owned",
          roleName: "Compliance Admin",
          owned: true,
          coldStart: true,
        }),
      ]),
    ).toEqual([
      { username: "first-owned", role: "Viewer", coldStart: false },
      {
        username: "second-owned",
        role: "Compliance Admin",
        coldStart: true,
      },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(publishedTestUsers([])).toEqual([]);
  });

  it("return value has no password field", () => {
    const [row] = publishedTestUsers([
      user({
        username: "test-viewer",
        roleName: "Viewer",
        owned: true,
      }),
    ]);
    expect(row).toBeDefined();
    expect(Object.keys(row!)).not.toContain("password");
    expect(row).not.toHaveProperty("password");
  });
});
