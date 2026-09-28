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

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { components } from "../../generated/aep-api";
import { sreRowState, sreStatusLabel } from "./sreAgent";

type ConfigProjection = components["schemas"]["ConfigProjection"];
type LLMProjection = components["schemas"]["LLMProjection"];
type SreAgentProjection = components["schemas"]["SreAgentProjection"];

const anthropic: LLMProjection = {
  kind: "anthropic",
  baseURL: "https://api.anthropic.com/v1",
  model: "claude-sonnet-5",
  keyPreview: "sk-a…wxyz",
  connectedAt: "2026-06-01T12:05:00Z",
  updatedAt: "2026-09-25T13:53:00Z",
  updatedBy: "dev@acme.example",
  priced: true,
  capabilities: {
    claudeSubscription: true,
    webSearch: "anthropic-server-tool",
    imageInput: "yes",
    nativePdf: true,
    generatedAgents: true,
    sreAgent: false,
  },
};

const defaultSreAgent: SreAgentProjection = {
  enabled: true,
  source: "none",
  model: "",
  host: "",
  status: "unconfigured",
  reason: "",
};

function config(over: Partial<ConfigProjection> = {}): ConfigProjection {
  return {
    llm: anthropic,
    llmFormats: [],
    agents: {
      runtime: "claude-code",
      availableRuntimes: ["claude-code", "opencode"],
      subscription: null,
      updatedAt: null,
      updatedBy: null,
    },
    gitProvider: null,
    idp: {
      kind: "platform",
      issuer: "https://idp.aep.local",
      jwksUrl: "https://idp.aep.local/.well-known/jwks.json",
      hasClientSecret: false,
      publisherClientId: "aep-console",
    },
    sreLlm: null,
    sreAgent: defaultSreAgent,
    ...over,
  };
}

describe("sreRowState", () => {
  it("is hidden when the server has no SRE agent", () => {
    expect(sreRowState(config({ sreAgent: null }))).toEqual({ kind: "hidden" });
  });

  it("inherits a bearer OpenAI-compatible org connection", () => {
    const cfg = config({
      sreAgent: { ...defaultSreAgent, source: "organization", model: "gpt-5.4", host: "api.openai.com", status: "running" },
    });
    expect(sreRowState(cfg)).toEqual({ kind: "inherited", model: "gpt-5.4", host: "api.openai.com" });
  });

  it("shows the override when one is set", () => {
    const cfg = config({
      sreLlm: {
        baseURL: "https://api.openai.com/v1",
        host: "api.openai.com",
        model: "gpt-5.4-mini",
        keyPreview: "sk-…abcd",
        connectedAt: "2026-09-20T08:00:00Z",
        updatedAt: "2026-09-20T08:00:00Z",
        updatedBy: "dev@acme.example",
      },
      sreAgent: { ...defaultSreAgent, source: "override" },
    });
    expect(sreRowState(cfg).kind).toBe("override");
  });

  it("is unavailable on an Anthropic org connection and names the format", () => {
    const cfg = config({ llm: { ...anthropic, capabilities: { ...anthropic.capabilities, sreAgent: false } } });
    const s = sreRowState(cfg);
    expect(s.kind).toBe("unavailable");
    expect((s as { reason: string }).reason).toMatch(/anthropic/i);
  });

  it("is unavailable with no org connection at all", () => {
    const cfg = config({ llm: null });
    const s = sreRowState(cfg);
    expect(s.kind).toBe("unavailable");
    expect((s as { reason: string }).reason).toBe("No model connection. Set an SRE model to enable RCA.");
  });
});

describe("sreStatusLabel", () => {
  it("shows the failure reason", () => {
    expect(sreStatusLabel("failed", "exited (code 3)")).toEqual({ text: "Failed: exited (code 3)", severity: "error" });
  });

  it("shows applying, running and not running", () => {
    expect(sreStatusLabel("applying")).toEqual({ text: "Applying…", severity: "info" });
    expect(sreStatusLabel("running")).toEqual({ text: "Running", severity: "success" });
    expect(sreStatusLabel("unconfigured")).toEqual({ text: "Not running", severity: "info" });
  });
});
