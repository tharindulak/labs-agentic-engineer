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
import { computeDependencyUsedBy } from "./dependencyUsedBy";
import type { components } from "../../../generated/aep-api";

type ComponentDependencies = components["schemas"]["ComponentDependencies"];

// The canonical #252 Task 15 case: thunder-app end-user auth, a platform
// resource declared identically on both a web-application and its backing
// service.
const SHARED: ComponentDependencies[] = [
  {
    componentName: "web-frontend",
    dependencies: [
      { kind: "platform-resource", name: "thunder-app", resourceType: "auth" },
      { kind: "external", name: "stripe" },
    ],
  },
  {
    componentName: "auth-service",
    dependencies: [
      { kind: "platform-resource", name: "thunder-app", resourceType: "auth" },
    ],
  },
];

describe("computeDependencyUsedBy (#252 Task 15)", () => {
  it("lists every component sharing an identical dependency, sorted, for each consumer queried", () => {
    expect(computeDependencyUsedBy(SHARED, "web-frontend")).toEqual({
      "thunder-app": ["auth-service", "web-frontend"],
    });
    expect(computeDependencyUsedBy(SHARED, "auth-service")).toEqual({
      "thunder-app": ["auth-service", "web-frontend"],
    });
  });

  it("omits a dependency only one component declares", () => {
    const result = computeDependencyUsedBy(SHARED, "web-frontend");
    expect(result).not.toHaveProperty("stripe");
  });

  it("does not merge the same dependency name declared with a different kind", () => {
    const differentKind: ComponentDependencies[] = [
      {
        componentName: "web-frontend",
        dependencies: [{ kind: "platform-resource", name: "thunder-app", resourceType: "auth" }],
      },
      {
        componentName: "auth-service",
        dependencies: [{ kind: "org-service", name: "thunder-app" }],
      },
    ];
    expect(computeDependencyUsedBy(differentKind, "web-frontend")).toEqual({});
    expect(computeDependencyUsedBy(differentKind, "auth-service")).toEqual({});
  });

  it("does not merge platform-resource entries with the same name but a different resourceType", () => {
    const differentResourceType: ComponentDependencies[] = [
      {
        componentName: "web-frontend",
        dependencies: [{ kind: "platform-resource", name: "thunder-app", resourceType: "auth" }],
      },
      {
        componentName: "auth-service",
        dependencies: [
          { kind: "platform-resource", name: "thunder-app", resourceType: "session-store" },
        ],
      },
    ];
    expect(computeDependencyUsedBy(differentResourceType, "web-frontend")).toEqual({});
  });

  it("merges external dependencies sharing the same name across components", () => {
    const sharedExternal: ComponentDependencies[] = [
      {
        componentName: "checkout-api",
        dependencies: [{ kind: "external", name: "sendgrid" }],
      },
      {
        componentName: "notifications-worker",
        dependencies: [{ kind: "external", name: "sendgrid" }],
      },
    ];
    expect(computeDependencyUsedBy(sharedExternal, "checkout-api")).toEqual({
      sendgrid: ["checkout-api", "notifications-worker"],
    });
  });

  it("returns {} for a component with no dependencies, or one not present in the list", () => {
    expect(computeDependencyUsedBy(SHARED, "unknown-component")).toEqual({});
    const noDeps: ComponentDependencies[] = [
      { componentName: "empty-component", dependencies: [] },
    ];
    expect(computeDependencyUsedBy(noDeps, "empty-component")).toEqual({});
  });

  it("degrades gracefully when a component's `dependencies` is null", () => {
    const nullDeps: ComponentDependencies[] = [
      { componentName: "web-frontend", dependencies: null },
    ];
    expect(computeDependencyUsedBy(nullDeps, "web-frontend")).toEqual({});
  });
});
