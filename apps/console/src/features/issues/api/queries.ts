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

import { useQueries, useQuery } from "@tanstack/react-query";
import { client } from "../../../api/client";
import { apiErrorMessage } from "../../../api/errors";
import { useProjectsList } from "../../projects/api/queries";
import { issueKeys } from "./keys";

// The label the SRE/RCA handoff stamps on every issue it files
// (sourcecontrol.LabelSREAgent, aep-api). Scopes both the Issues page and
// the notification bell's fan-out to issues this feature actually owns.
export const SRE_AGENT_LABEL = "sre-agent";

// Issues page (placeholder #173): one project's SRE-agent-filed issues.
export function useProjectIssues(projectName: string) {
  return useQuery({
    queryKey: issueKeys.list(projectName),
    queryFn: async () => {
      const { data, error } = await client.GET("/projects/{projectName}/issues", {
        params: {
          path: { projectName },
          query: { labels: SRE_AGENT_LABEL },
        },
      });
      if (error) {
        throw new Error(apiErrorMessage(error, "Failed to load issues"));
      }
      return data ?? [];
    },
  });
}

export interface AttentionIssue {
  project: string;
  number: number;
  title: string;
  url: string;
  reason: string;
}

// No pagination, last N projects — the same "no pagination, last N" shape
// the alerts bell already uses (BELL_LIMIT), since this feeds a bell too.
const ATTENTION_PROJECTS_LIMIT = 50;

// Top-nav bell: every sre-agent issue, across every project, currently in
// one of the three human-attention states. list-issues is project-scoped,
// so this fans out one call per project and merges — a deliberate N+1 from
// the browser (see the design doc's "Bell scope" section), not a new
// backend aggregate endpoint.
export function useAttentionIssues() {
  const projectsQuery = useProjectsList("", ATTENTION_PROJECTS_LIMIT);
  const projects = (projectsQuery.data?.pages[0]?.items ?? [])
    .map((p) => p.name)
    .filter((name): name is string => !!name);

  return useQueries({
    queries: projects.map((projectName) => ({
      queryKey: issueKeys.attention(projectName),
      queryFn: async () => {
        const { data, error } = await client.GET("/projects/{projectName}/issues", {
          params: {
            path: { projectName },
            query: { labels: SRE_AGENT_LABEL },
          },
        });
        if (error) {
          throw new Error(apiErrorMessage(error, "Failed to load issues"));
        }
        return (data ?? [])
          .filter((issue) => !!issue.AttentionReason)
          .map((issue): AttentionIssue => ({
            project: projectName,
            number: issue.Number,
            title: issue.Title,
            url: issue.URL,
            reason: issue.AttentionReason,
          }));
      },
    })),
    combine: (results) => ({
      isPending: projectsQuery.isPending || results.some((r) => r.isPending),
      items: results.flatMap((r) => r.data ?? []),
      failedCount: results.filter((r) => r.isError).length,
    }),
  });
}
