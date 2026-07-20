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

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMcpOptions, resolveBaseAgentConfig } from "./runner.js";

const BASE_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];
const MCP_TOOLS = [
  "mcp__aep__list_org_component_endpoints",
  "mcp__aep__get_remote_git_file_contents",
  "mcp__aep__search_remote_git_code",
];

test("buildMcpOptions: registers the aep MCP server and tools when both envs are set", () => {
  const result = buildMcpOptions("https://bff.example.com/internal/v1/mcp", "mcp-token-xyz");

  assert.deepEqual(result.mcpServers, {
    aep: {
      type: "http",
      url: "https://bff.example.com/internal/v1/mcp",
      headers: { Authorization: "Bearer mcp-token-xyz" },
    },
  });
  assert.deepEqual(result.allowedTools, [...BASE_TOOLS, ...MCP_TOOLS]);
});

test("buildMcpOptions: omits mcpServers and MCP tools when the token is missing", () => {
  const result = buildMcpOptions("https://bff.example.com/internal/v1/mcp", undefined);

  assert.equal(result.mcpServers, undefined);
  assert.deepEqual(result.allowedTools, BASE_TOOLS);
});

test("buildMcpOptions: omits mcpServers and MCP tools when the url is missing", () => {
  const result = buildMcpOptions(undefined, "mcp-token-xyz");

  assert.equal(result.mcpServers, undefined);
  assert.deepEqual(result.allowedTools, BASE_TOOLS);
});

test("buildMcpOptions: omits mcpServers and MCP tools when both are empty strings", () => {
  const result = buildMcpOptions("", "");

  assert.equal(result.mcpServers, undefined);
  assert.deepEqual(result.allowedTools, BASE_TOOLS);
});

test("buildMcpOptions: omits mcpServers and MCP tools when both are undefined", () => {
  const result = buildMcpOptions(undefined, undefined);

  assert.equal(result.mcpServers, undefined);
  assert.deepEqual(result.allowedTools, BASE_TOOLS);
});

// --- resolveBaseAgentConfig: the defaults are pinned byte-identical to the
// pre-parameterization behavior (docs/design/playground.md §3) ---------------

const SHIPPED_PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../plugin");

test("resolveBaseAgentConfig: defaults pin today's plugin + preload exactly", () => {
  const impl = resolveBaseAgentConfig(undefined, "implementation");
  assert.equal(impl.pluginPath, SHIPPED_PLUGIN);
  assert.deepEqual(impl.preload, ["aep:aep"]);

  const val = resolveBaseAgentConfig(undefined, "validation");
  assert.equal(val.pluginPath, SHIPPED_PLUGIN);
  assert.deepEqual(val.preload, ["aep:aep", "aep:aep-validation"]);
});

test("resolveBaseAgentConfig: an explicit basePreload owns the FULL list (no validation append)", () => {
  const local = resolveBaseAgentConfig(
    { basePluginPath: "/x/plugin-local", basePreload: ["aep-local:aep-local"] },
    "validation",
  );
  assert.equal(local.pluginPath, "/x/plugin-local");
  assert.deepEqual(local.preload, ["aep-local:aep-local"]);
});
