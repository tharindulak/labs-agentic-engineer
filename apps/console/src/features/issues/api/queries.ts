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

import { useQuery } from "@tanstack/react-query";
import { client } from "../../../api/client";
import { apiErrorMessage } from "../../../api/errors";
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
