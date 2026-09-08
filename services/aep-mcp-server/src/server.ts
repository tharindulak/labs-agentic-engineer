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
import {
  type IncidentIdentity,
  resolveHandoff,
  sanitizeForLog,
} from "./handoffContext.js";
import { annotatePlatformIssues } from "./platformIssues.js";

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof AepApiError ? `aep-api ${err.status}: ${err.message}` : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}


export interface HandoffRequestContext {
  identity: IncidentIdentity;
  adopt: boolean;
}

/**
 * Builds an McpServer bound to one caller's bearer token. Called once per
 * incoming HTTP request (see main.ts) — this server holds no credentials or
 * state of its own; every tool call forwards `client.bearer` straight
 * through to aep-api, which performs the actual org-scoped auth check.
 *
 * Two tools, not three. There is no dispatch tool: adoption moved into
 * create-issue, so filing an issue and handing it to the coding agent are one
 * call and cannot come apart. The other way to adopt an issue that already
 * exists is the `aep` arming GitHub label, which AE's event plane watches —
 * a human's route, not this server's.
 */
export function createAepMcpServer(
  client: AepClientOptions,
  handoff: HandoffRequestContext,
  create: typeof createIssue = createIssue,
): McpServer {
  const server = new McpServer({ name: "aep-mcp-server", version: "0.0.0" });

  server.registerTool(
    "ae_search_related_issues",
    {
      title: "Search related AE issues",
      description:
        "Search existing GitHub issues on a project's repo to find related/duplicate issues before filing a new one. " +
        "Keyword-ranked: pass space-separated keywords (component name + symptom terms), not a sentence; results come back ranked by keyword overlap for you to judge. " +
        "An issue marked `PlatformRecord: true` is AE's own plan for what to BUILD, not a defect report: read `ReadAs` on it before you treat it as evidence about whether something is broken.",
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
        const scoped = handoff.identity.project ?? project;
        if (handoff.identity.project !== undefined && handoff.identity.project !== project) {
          // Same asymmetry the create path already logs (resolveHandoff's
          // `notes`): a search scoped away from the project the model asked
          // for should leave a trace too, not just create.
          process.stderr.write(
            `handoff resolve: project ${sanitizeForLog(project)} from the call was overridden by the incident header\n`,
          );
        }
        const issues = await listIssues(client, scoped, {
          ...(query !== undefined ? { query } : {}),
          ...(labels !== undefined ? { labels } : {}),
        });
        // Annotated here rather than left to the caller's prompt: what AE's own
        // planned-work issues mean is AE's fact, and a reader that gets it wrong
        // rules out a code change it should have filed. See platformIssues.ts.
        return textResult(annotatePlatformIssues(issues));
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
        "File every report that reaches you. What the work IS, and whether a coding agent gets it, are not yours to decide: pass `actionStatuses` and the platform derives both, answering the classification it chose. " +
        "A `config-level` answer means the remediation agent already expressed every action as configuration — the issue is still filed, as a ledger entry, and nothing is dispatched over it. " +
        "Deduplication is automatic: this server derives a stable key from the incident this request belongs to, so if an OPEN issue for the same incident exists it is returned with `deduped: true`, nothing is created, and nothing is dispatched (the run that created that issue owns its dispatch). An issue already carrying a no-change verdict for this incident answers `suppressed: true`, and nothing is created. " +
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
            "The component this issue is about. AE's design names it unprefixed ('service1'), and a name carrying its project prefix ('myproject-service1') is resolved to the design name for you, so pass whichever your world uses. Checked before the issue is filed — a name the design carries under neither form fails this call rather than surfacing later inside a coding cycle.",
          ),
        actionStatuses: z
          .array(z.string().nullable())
          .optional()
          .describe(
            "The remediation agent's status for each recommended action on this RCA report — one entry per action, in the report's own order. Send null for an action carrying no status; that means the remediation stage did not run, which is PENDING work, and dropping the entry instead would read as an action-free report. The platform derives the handoff classification and the adoption from these and answers the classification back. Omit the field only when there is no RCA report behind the call.",
          ),
      },
    },
    async ({ project, title, body, labels, componentName, actionStatuses }) => {
      try {
        const resolved = resolveHandoff(
          handoff.identity,
          {
            project,
            ...(componentName !== undefined ? { componentName } : {}),
            ...(labels !== undefined ? { labels } : {}),
          },
          handoff.adopt,
        );
        for (const note of resolved.notes) {
          process.stderr.write(`handoff resolve: ${note}\n`);
        }
        const issue = await create(client, resolved.project, {
          title,
          body,
          labels: resolved.labels,
          ...(resolved.componentName !== undefined ? { componentName: resolved.componentName } : {}),
          ...(resolved.dedupeKey !== undefined ? { dedupeKey: resolved.dedupeKey } : {}),
          adopt: resolved.adopt,
          // Forwarded only when sent: an absent field tells aep-api to leave
          // adoption and the dedupe namespace alone, which is what a caller with
          // no RCA report behind it needs. An empty array is a different claim —
          // a report with no recommended actions.
          ...(actionStatuses !== undefined ? { actionStatuses } : {}),
        });
        return textResult(issue);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}
