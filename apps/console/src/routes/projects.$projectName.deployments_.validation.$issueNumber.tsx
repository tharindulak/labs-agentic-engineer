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

import { createFileRoute } from "@tanstack/react-router";
import { ValidationPage } from "../features/tasks/components/ValidationPage";

// `deployments_` escapes the deployments route (it renders no Outlet) while
// keeping the /deployments/... path, so the sidebar/header section stays
// "Deployments" on this page.
export const Route = createFileRoute(
  "/projects/$projectName/deployments_/validation/$issueNumber",
)({
  params: {
    parse: (params) => {
      const issueNumber = Number(params.issueNumber);
      if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
        throw new Error(`invalid issue number: ${params.issueNumber}`);
      }
      return { ...params, issueNumber };
    },
    stringify: (params) => ({
      ...params,
      issueNumber: String(params.issueNumber),
    }),
  },
  component: ValidationRoute,
});

function ValidationRoute() {
  const { projectName, issueNumber } = Route.useParams();
  return (
    <ValidationPage projectName={projectName} issueNumber={issueNumber} />
  );
}
