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
import { activityKeys } from "./keys";

// Initial page of the project's activity feed. Liveness comes from the SSE tail
// (useActivityFeed), so this doesn't poll — it just seeds the list.
export function useProjectActivity(projectName: string) {
  return useQuery({
    queryKey: activityKeys.list(projectName),
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/projects/{projectName}/activity",
        { params: { path: { projectName } } },
      );
      if (error || data === undefined) {
        throw new Error(apiErrorMessage(error, "Failed to load activity"));
      }
      return data.items ?? [];
    },
  });
}
