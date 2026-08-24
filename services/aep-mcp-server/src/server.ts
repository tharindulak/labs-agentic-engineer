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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { AepApiError, type AepClientOptions, createIssue, listIssues } from "./aepClient.js";
import { validateDecline } from "./decline.js";

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof AepApiError ? `aep-api ${err.status}: ${err.message}` : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}


/**
 * Builds an McpServer bound to one caller's bearer token. Called once per
 * incoming HTTP request (see main.ts) — this server holds no credentials or
 * state of its own; every tool call forwards `client.bearer` straight
 * through to aep-api, which performs the actual org-scoped auth check.
 *
 * There is no dispatch tool: adoption moved into create-issue, so filing an
 * issue and handing it to the coding agent are one call and cannot come apart.
 * The other way to adopt an issue that already exists is the `aep` arming
 * GitHub label, which AE's event plane watches — a human's route, not this
 * server's.
 *
 * The handoff has exactly two terminal moves, and both are calls here:
 * `ae_create_issue` to file, `ae_decline_issue` to rule a code change out. That
 * symmetry is the point — a turn that ends with neither is a protocol
 * violation rather than a silent decision nobody can see.
 */
export function createAepMcpServer(client: AepClientOptions): McpServer {
  const server = new McpServer({ name: "aep-mcp-server", version: "0.0.0" });

  server.registerTool(
    "ae_search_related_issues",
    {
      title: "Search related AE issues",
      description:
        "Search existing GitHub issues on a project's repo to find related/duplicate issues before filing a new one. " +
        "Keyword-ranked: pass space-separated keywords (component name + symptom terms), not a sentence; results come back ranked by keyword overlap for you to judge.",
      inputSchema: {
        project: z.string().describe("OpenChoreo/AE project name"),
        query: z
          .string()
          .optional()
          .describe(
            "Space-separated keywords (e.g. 'service1 service2 timeout'), NOT a natural-language phrase. Tokenised and matched against issue title/body; issues are returned ranked by how many keywords they contain. Omit to list all issues.",
          ),
        labels: z.array(z.string()).optional().describe("Filter by GitHub labels"),
      },
    },
    async ({ project, query, labels }) => {
      try {
        // A conditional spread (rather than `{ query, labels }` directly) is
        // required under exactOptionalPropertyTypes: zod's optional args
        // destructure to `undefined` when absent, and explicitly assigning
        // `undefined` to an optional field is rejected — omitting the key
        // entirely is not.
        const issues = await listIssues(client, project, {
          ...(query !== undefined ? { query } : {}),
          ...(labels !== undefined ? { labels } : {}),
        });
        return textResult(issues);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "ae_create_issue",
    {
      title: "Create a GitHub issue via AE",
      description:
        "Create a GitHub issue on a project's repo AND hand it to the AE coding agent. Creating the issue IS the dispatch — there is no second call. " +
        "Use this for a code-level fix; config-level changes do not belong here. " +
        "Pass a stable dedupeKey so concurrent callers reporting the same incident share one issue: if an OPEN issue with the same key exists, it is returned with `deduped: true`, nothing is created, and nothing is dispatched (the run that created that issue owns its dispatch). " +
        "If instead a CLOSED issue with that key is found — the same incident recurring after a fix was merged — it is reopened with this call's body appended as a `## Recurrence <n>` section, moved into the currently deployed version's milestone and handed back to the coding agent; the result then carries `reopened: true` and `recurrence` (which attempt this is). " +
        "The result's `adopted` says whether anything will actually work the issue, and `adoptionError` says why not when it will not — a project with no built version yet gets its issue recorded but not worked.",
      inputSchema: {
        project: z.string().describe("OpenChoreo/AE project name"),
        title: z.string().describe("Issue title"),
        body: z.string().describe("Issue body (markdown)"),
        labels: z.array(z.string()).optional().describe("GitHub labels to apply"),
        componentName: z
          .string()
          .optional()
          .describe(
            "The component this issue is about, as AE's design names it: UNPREFIXED (e.g. 'service1', not 'myproject-service1'). Checked before the issue is filed — a name the design does not carry fails this call rather than surfacing later inside a coding cycle.",
          ),
        dedupeKey: z
          .string()
          .optional()
          .describe(
            "Stable idempotency key (e.g. 'sre-rca/<component>'). While an issue created with this key is open, further creates with the same key return that issue (deduped: true) instead of filing a duplicate.",
          ),
        adopt: z
          .boolean()
          .optional()
          .describe(
            "Defaults to TRUE: the issue is handed to the coding agent. Pass false only to file a ledger entry — an issue recorded against the version that nothing will work until a human adopts it.",
          ),
      },
    },
    async ({ project, title, body, labels, componentName, dedupeKey, adopt }) => {
      try {
        const issue = await createIssue(client, project, {
          title,
          body,
          ...(labels !== undefined ? { labels } : {}),
          ...(componentName !== undefined ? { componentName } : {}),
          ...(dedupeKey !== undefined ? { dedupeKey } : {}),
          ...(adopt !== undefined ? { adopt } : {}),
        });
        return textResult(issue);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "ae_decline_issue",
    {
      title: "Rule out a code change for an RCA root cause",
      description:
        "Record that an RCA root cause needs NO code change. This is the other way a handoff may end: file with ae_create_issue, or rule out with this call — ending a turn with neither hands nothing over and drops the incident. " +
        "A decline must justify itself. Pass one ruledOut entry PER remaining recommended action; an action you cannot account for is an action that needs a code change, so file instead. " +
        "Each entry names the hardening change you considered and why applying it would contradict the spec. 'It is intended behaviour' is not a justification — as-designed behaviour can still be hardened, and the test is whether a code change would help WITHOUT contradicting the spec. " +
        "An inadequate decline is refused with the reasons, and you should either fix it or file the issue. " +
        "This call records the judgment for review; carry the same ruledOut into the report's `## Ruled out` section so it is persisted with the diagnosis.",
      inputSchema: {
        project: z.string().describe("OpenChoreo/AE project name"),
        component: z
          .string()
          .optional()
          .describe("The component the root cause is about, UNPREFIXED (e.g. 'service1')"),
        rootCause: z
          .string()
          .describe("The root cause being declined, quoted from the report, so the record stands alone"),
        ruledOut: z
          .array(
            z.object({
              action: z
                .string()
                .describe("The recommended action this entry rules out, quoted from the report"),
              case: z
                .enum(["config-actionable", "names-nothing-to-change"])
                .describe(
                  "config-actionable: already actionable as configuration (status 'revised' with a change object). names-nothing-to-change: pure advice with no fault behind it",
                ),
              why: z.string().describe("Why that case applies to THIS action"),
              hardeningRuledOut: z
                .string()
                .describe(
                  "The hardening change you considered for this action (e.g. 'make the delay configurable') and why applying it would contradict the spec",
                ),
            }),
          )
          .describe("One entry per remaining recommended action"),
      },
    },
    async ({ project, component, rootCause, ruledOut }) => {
      const verdict = validateDecline({
        project,
        rootCause,
        ruledOut,
        ...(component !== undefined ? { component } : {}),
      });
      if (!verdict.ok) {
        // isError so the agent sees this as a refusal it must answer, the same
        // way a failed ae_create_issue comes back to it.
        return {
          content: [{ type: "text" as const, text: `decline refused: ${verdict.error}` }],
          isError: true,
        };
      }
      return textResult({
        declined: true,
        project,
        ...(component !== undefined ? { component } : {}),
        rootCause,
        ruledOut,
        next: "Include this ruledOut as a `## Ruled out` section in the report diagnosis.",
      });
    },
  );

  return server;
}
