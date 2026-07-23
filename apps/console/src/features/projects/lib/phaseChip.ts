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

import type { StatusTone } from "../../../components/StatusChip";
import type { components } from "../../../generated/aep-api";

type ProjectStatus = components["schemas"]["ProjectStatus"];

// Phase → header chip (moved out of ProjectLayout in Task 5, once every
// project sub-page grew its own PageHeader instead of sharing one rendered
// by the layout). Values from aep-api's project_service.go.
export function phaseChip(status: ProjectStatus): {
  label: string;
  tone: StatusTone;
} {
  switch (status.phase) {
    case "no-repo":
      return { label: "No repository", tone: "warning" };
    case "repo-cloning":
      return { label: "Preparing repository", tone: "info" };
    case "repo-error":
      return { label: "Repository error", tone: "error" };
    case "prompt":
      return { label: "Starting", tone: "info" };
    case "spec":
      return { label: "Spec in progress", tone: "info" };
    case "tasks":
      return { label: "Building", tone: "info" };
    case "components":
      return { label: "Active", tone: "success" };
    default:
      return { label: status.phase, tone: "neutral" };
  }
}
