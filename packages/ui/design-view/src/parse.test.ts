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

import { describe, it, expect } from "vitest";
import { parseComponentDesign } from "./parse.js";

const FULL = JSON.stringify({
  name: "audit-evidence-api",
  type: "service",
  version: "0.1.0",
  language: "Go",
  buildpack: "docker",
  appPath: "audit-evidence-api",
  entrypoint: "deployment/service",
  exposure: "internet",
  description: "Stores and serves audit evidence records.",
  skillsApplied: ["go", "openapi-conventions"],
  endpoint: { name: "http" },
  exposesAPI: { some: "platform-owned" },
  componentAgentInstructions: "platform-owned",
  dependencies: [
    { kind: "component", name: "audit-evidence-webapp", description: "The SPA." },
    {
      kind: "platform-resource",
      name: "orders-db",
      resourceType: "postgres",
      parameters: { size: "small" },
      description: "Stores rows.",
    },
    {
      kind: "external",
      name: "stripe",
      specPath: "https://x/openapi.yaml",
      config: [{ key: "STRIPE_API_KEY", secret: true }],
      description: "Charges customers.",
    },
    { kind: "org-service", name: "identity-api", description: "Verifies tokens." },
  ],
});

describe("parseComponentDesign", () => {
  it("round-trips a full design.json", () => {
    const d = parseComponentDesign(FULL);
    expect("kind" in d).toBe(false); // not a ParseError
    if ("kind" in d) return;
    expect(d.name).toBe("audit-evidence-api");
    expect(d.type).toBe("service");
    expect(d.exposure).toBe("internet");
    expect(d.description).toBe("Stores and serves audit evidence records.");
    expect(d.skillsApplied).toEqual(["go", "openapi-conventions"]);
    expect(d.endpoint).toEqual({ name: "http" });
    expect(d.dependencies).toHaveLength(4);
    const stripe = d.dependencies.find((x) => x.name === "stripe")!;
    expect(stripe.kind).toBe("external");
    expect(stripe.config).toEqual([
      { key: "STRIPE_API_KEY", secret: true },
    ]);
    const db = d.dependencies.find((x) => x.name === "orders-db")!;
    expect(db.resourceType).toBe("postgres");
    expect(db.parameters).toEqual({ size: "small" });
  });

  it("omits absent optional fields and defaults dependencies to []", () => {
    const d = parseComponentDesign(
      JSON.stringify({ name: "svc", type: "service", version: "0.1.0" }),
    );
    if ("kind" in d) throw new Error("unexpected parse error");
    expect(d.description).toBeUndefined();
    expect(d.skillsApplied).toBeUndefined();
    expect(d.endpoint).toBeUndefined();
    expect(d.dependencies).toEqual([]);
  });

  it("ignores unknown/platform-owned fields and drops nameless deps", () => {
    const d = parseComponentDesign(
      JSON.stringify({
        name: "svc",
        exposesAPI: { x: 1 },
        componentAgentInstructions: "y",
        dependencies: [{ kind: "component" }, { kind: "component", name: "ok" }],
      }),
    );
    if ("kind" in d) throw new Error("unexpected parse error");
    expect(d.dependencies).toEqual([{ kind: "component", name: "ok" }]);
  });

  it("labels a dependency with no kind as unknown", () => {
    const d = parseComponentDesign(
      JSON.stringify({ name: "svc", dependencies: [{ name: "mystery" }] }),
    );
    if ("kind" in d) throw new Error("unexpected parse error");
    expect(d.dependencies).toEqual([{ kind: "unknown", name: "mystery" }]);
  });

  it("returns a ParseError on malformed JSON", () => {
    const d = parseComponentDesign("{ not json");
    expect("kind" in d && d.kind).toBe("parse-error");
  });

  it("returns a ParseError when the top level is not an object", () => {
    expect("kind" in parseComponentDesign("42")).toBe(true);
    expect("kind" in parseComponentDesign("[]")).toBe(true);
  });

  it("filters non-string skillsApplied entries", () => {
    const d = parseComponentDesign(
      JSON.stringify({ name: "svc", skillsApplied: ["go", 3, null, "react"] }),
    );
    if ("kind" in d) throw new Error("unexpected parse error");
    expect(d.skillsApplied).toEqual(["go", "react"]);
  });

  // #252 Task 9: style/package/candidates are persisted intent
  // (component-design.schema.json), unlike status/reason which are read-time
  // computed and never present in the raw file — see the file-header comment.
  describe("external dependency intent fields (#252 Task 9)", () => {
    it("parses style, package, specPath, and candidates", () => {
      const d = parseComponentDesign(
        JSON.stringify({
          name: "svc",
          dependencies: [
            {
              kind: "external",
              name: "payments",
              style: "sdk",
              package: "npm:stripe@^14",
              specPath: "https://stripe.com/openapi.yaml",
              candidates: [
                { name: "stripe", style: "sdk" },
                { name: "adyen", style: "rest-api" },
              ],
            },
          ],
        }),
      );
      if ("kind" in d) throw new Error("unexpected parse error");
      const dep = d.dependencies[0]!;
      expect(dep.style).toBe("sdk");
      expect(dep.package).toBe("npm:stripe@^14");
      expect(dep.specPath).toBe("https://stripe.com/openapi.yaml");
      expect(dep.candidates).toEqual([
        { name: "stripe", style: "sdk" },
        { name: "adyen", style: "rest-api" },
      ]);
    });

    it("omits candidates/style/package/specPath when absent, never emitting empty arrays", () => {
      const d = parseComponentDesign(
        JSON.stringify({
          name: "svc",
          dependencies: [{ kind: "external", name: "payments" }],
        }),
      );
      if ("kind" in d) throw new Error("unexpected parse error");
      const dep = d.dependencies[0]!;
      expect(dep.style).toBeUndefined();
      expect(dep.package).toBeUndefined();
      expect(dep.specPath).toBeUndefined();
      expect(dep.candidates).toBeUndefined();
    });

    it("drops nameless candidates", () => {
      const d = parseComponentDesign(
        JSON.stringify({
          name: "svc",
          dependencies: [
            {
              kind: "external",
              name: "payments",
              candidates: [{ style: "sdk" }, { name: "stripe", style: "sdk" }],
            },
          ],
        }),
      );
      if ("kind" in d) throw new Error("unexpected parse error");
      const dep = d.dependencies[0]!;
      expect(dep.candidates).toEqual([{ name: "stripe", style: "sdk" }]);
    });

    it("never carries status/reason — those are not parsed from the raw file", () => {
      const d = parseComponentDesign(
        JSON.stringify({
          name: "svc",
          dependencies: [
            { kind: "external", name: "payments", status: "resolved", reason: "ignored" },
          ],
        }),
      );
      if ("kind" in d) throw new Error("unexpected parse error");
      const dep = d.dependencies[0] as unknown as Record<string, unknown>;
      expect(dep.status).toBeUndefined();
      expect(dep.reason).toBeUndefined();
    });
  });
});
