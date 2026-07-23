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
 * `isAnthropicModel` gates the provider-executed `web_search` tool (external-
 * dependency-discovery #252) — Anthropic-specific, so injecting it against a
 * non-Anthropic model would error. `webSearchTool` is the tool itself; pinned
 * here to the `@ai-sdk/anthropic` provider-tool id so a version bump that
 * renames/removes `webSearch_20250305` fails this test instead of silently
 * shipping a broken (or missing) tool.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { LanguageModel } from "ai";
import { isAnthropicModel, webSearchTool } from "./model.js";

test("isAnthropicModel: true for a model whose provider starts with 'anthropic'", () => {
  const model = { provider: "anthropic.messages", modelId: "claude-sonnet-4-6" } as unknown as LanguageModel;
  assert.equal(isAnthropicModel(model), true);
});

test("isAnthropicModel: false for a non-Anthropic provider", () => {
  const model = { provider: "openai.chat", modelId: "gpt-5" } as unknown as LanguageModel;
  assert.equal(isAnthropicModel(model), false);
});

test("isAnthropicModel: false when provider is absent, not a string, or model is not an object", () => {
  assert.equal(isAnthropicModel({} as unknown as LanguageModel), false);
  assert.equal(isAnthropicModel({ provider: 42 } as unknown as LanguageModel), false);
  assert.equal(isAnthropicModel("claude-sonnet-4-6" as unknown as LanguageModel), false);
});

test("webSearchTool: the Anthropic web_search_20250305 provider tool, isProviderExecuted", () => {
  const tool = webSearchTool();
  assert.equal((tool as { id?: string }).id, "anthropic.web_search_20250305");
  assert.equal((tool as { isProviderExecuted?: boolean }).isProviderExecuted, true);
});
