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
import { buildDependencyResolutionMessage } from "./dependencyResolutionMessage";
import type { components } from "../../../generated/aep-api";

type Dependency = components["schemas"]["Dependency"];

const ambiguousDep: Dependency = {
  kind: "external",
  name: "email-provider",
  description: "Transactional email for signup + reset flows.",
  status: "ambiguous",
  reason: "2 candidates available",
  candidates: [
    {
      name: "sendgrid-rest",
      style: "rest-api",
      description: "SendGrid v3 Web API",
    },
    {
      name: "resend-sdk",
      style: "sdk",
      description: "Resend Node SDK",
      package: "npm:resend@^4.0.0",
    },
  ],
};

const resolvedDep: Dependency = {
  kind: "external",
  name: "stripe",
  status: "resolved",
  style: "sdk",
  package: "npm:stripe@^17.0.0",
};

// #252 Task 17 (Q4): the message dropped the embedded dependency JSON + the
// resolution playbook — the chat agent gets both from design.json's live
// snapshot and the high-level-architecture skill (Task 16), so the seed
// message only needs to name the component + dependency + intent.
describe("buildDependencyResolutionMessage — lean seed message (#252 Task 17)", () => {
  it("resolve intent: names the dependency and component, asking to resolve", () => {
    const msg = buildDependencyResolutionMessage(
      "checkout-api",
      ambiguousDep,
      "resolve",
    );
    expect(msg).toContain("email-provider");
    expect(msg).toContain("checkout-api");
    expect(msg).toMatch(/resolve/i);
    expect(msg).not.toMatch(/reconsider/i);
  });

  it("reconsider intent: names the dependency and component, asking to look at other options", () => {
    const msg = buildDependencyResolutionMessage(
      "checkout-api",
      resolvedDep,
      "reconsider",
    );
    expect(msg).toContain("stripe");
    expect(msg).toContain("checkout-api");
    expect(msg).toMatch(/reconsider/i);
    expect(msg).toMatch(/other options/i);
  });

  it("never embeds the dependency's JSON entry", () => {
    const resolveMsg = buildDependencyResolutionMessage(
      "checkout-api",
      ambiguousDep,
      "resolve",
    );
    const reconsiderMsg = buildDependencyResolutionMessage(
      "checkout-api",
      resolvedDep,
      "reconsider",
    );
    // The old shape fenced a JSON block and printed field names verbatim —
    // none of that survives the lean message.
    expect(resolveMsg).not.toContain("```");
    expect(resolveMsg).not.toContain(JSON.stringify(ambiguousDep));
    expect(resolveMsg).not.toContain("candidates");
    expect(reconsiderMsg).not.toContain("```");
    expect(reconsiderMsg).not.toContain("style");
    expect(reconsiderMsg).not.toContain("package");
  });

  it("never embeds the resolution playbook", () => {
    const msg = buildDependencyResolutionMessage(
      "checkout-api",
      ambiguousDep,
      "resolve",
    );
    expect(msg).not.toContain("high-level-architecture");
    expect(msg).not.toContain("specPath");
    expect(msg).not.toContain("docsUrl");
    expect(msg).not.toMatch(/only this dependency/i);
  });

  it("degrades gracefully when the dependency carries no extra fields (status/reason absent)", () => {
    const bareDep: Dependency = { kind: "external", name: "github" };
    const msg = buildDependencyResolutionMessage("issue-sync", bareDep, "resolve");
    expect(msg).not.toContain("undefined");
    expect(msg).toContain("github");
    expect(msg).toContain("issue-sync");
  });
});
