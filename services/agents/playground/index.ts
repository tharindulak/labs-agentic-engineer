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
 * The playground kit — the reusable pieces of the in-package chat playground
 * that the root-level playground composes: dir-parameterized project-folder
 * I/O, stream rendering, derived-artifact materialization, and the MCP
 * discovery resolver. Exported as `@aep/agents/playground-kit` (see
 * package.json `exports`).
 */

export { readProjectFiles, reconcileDir, resolveWithin, type ChangeKind, type FileChange } from "./project-fs.js";
export { renderPart, renderSummary } from "./render.js";
export { materializeDerived, type DerivedNote } from "./derived.js";
export { createMcpResolver, readMcpEnv, DEFAULT_MCP_URL, type McpEnv, type McpResolver } from "./mcp.js";
