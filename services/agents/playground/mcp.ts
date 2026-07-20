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
 * Playground MCP token resolution (Task: playground-token). Bridges the
 * AEP_MCP_URL / AEP_MCP_TOKEN / AEP_MCP_ORG env vars into a `TurnRequest.mcp`
 * bundle:
 *
 *  - AEP_MCP_TOKEN set → used verbatim, forever. An operator-supplied token is
 *    trusted as-is; the resolver never mints when one is present.
 *  - AEP_MCP_TOKEN unset, AEP_MCP_URL set → mint a FRESH token on every
 *    `resolve()` call against aep-api's `POST {AEP_MCP_URL}/playground-token`
 *    (requires `PLAYGROUND_TOKEN_ENABLED=true` on that aep-api — local dev
 *    only; see deployments/docker-compose.yml). No caching: the minted
 *    token's ~5-minute TTL is shorter than a chat session, so every turn
 *    re-mints rather than risking a mid-turn 401.
 *  - Mint failure (network error or non-2xx) degrades to no MCP tools for
 *    that call and prints exactly ONE warning for the resolver's lifetime —
 *    a dead/misconfigured aep-api shouldn't spam the TUI on every turn.
 *  - Neither var set → undefined, unconditionally (today's behavior).
 */

import type { TurnRequest } from "@aep/agent-stream";

export interface McpEnv {
  url?: string | undefined;
  token?: string | undefined;
  org?: string | undefined;
}

export interface McpResolver {
  /** Resolves the mcp bundle for one turn. Never throws. */
  resolve(): Promise<TurnRequest["mcp"]>;
}

/**
 * Reads the AEP_MCP_* vars — the only inputs this module reads from the
 * environment. AEP_MCP_URL defaults to the local compose stack's aep-api
 * (the playground is a local-dev tool); set it to an empty string to run
 * without MCP discovery entirely.
 */
export const DEFAULT_MCP_URL = "http://localhost:9090/internal/v1/mcp";

export function readMcpEnv(env: NodeJS.ProcessEnv = process.env): McpEnv {
  return {
    url: env.AEP_MCP_URL ?? DEFAULT_MCP_URL,
    token: env.AEP_MCP_TOKEN,
    org: env.AEP_MCP_ORG,
  };
}

/**
 * Builds a resolver over a fixed `McpEnv` snapshot. `warn` is invoked at most
 * once — the first time a mint attempt fails — so a single resolver (one per
 * playground session, shared across every thread/turn) never nags twice.
 */
export function createMcpResolver(env: McpEnv, warn: (message: string) => void): McpResolver {
  let warned = false;
  return {
    async resolve() {
      if (!env.url) return undefined;
      if (env.token) return { url: env.url, token: env.token };
      try {
        const res = await fetch(`${env.url}/playground-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgHandle: env.org ?? "default" }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { token?: string };
        if (!body.token) throw new Error("response carried no token");
        return { url: env.url, token: body.token };
      } catch (e) {
        if (!warned) {
          warned = true;
          const reason = e instanceof Error ? e.message : String(e);
          warn(`mcp: failed to mint a playground token from ${env.url} (${reason}) — continuing without MCP tools`);
        }
        return undefined;
      }
    },
  };
}
