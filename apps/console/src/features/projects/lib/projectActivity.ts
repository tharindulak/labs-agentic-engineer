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
import { taskChip } from "../../tasks/api/status";

type TaskView = components["schemas"]["TaskView"];

// The per-component roll-up is DERIVED from the build tasks: each
// component's status is the roll-up of its own tasks. (The overview's
// "agent activity" feed used to be derived the same way; it now reads the
// real activity-event stream — see features/activity.)

/** A component's build state is the roll-up of its tasks: any failed → Failed,
 *  any still working → Building, otherwise Deployed. Falls back to Pending
 *  when the plan hasn't produced tasks for it yet. */
export function componentStatus(
  componentName: string,
  tasks: TaskView[],
): { label: string; tone: StatusTone } {
  const own = tasks.filter((t) => t.component === componentName);
  if (own.length === 0) return { label: "Pending", tone: "neutral" };
  const tones = own.map((t) => taskChip(t.derivedStatus).tone);
  if (tones.includes("error")) return { label: "Failed", tone: "error" };
  if (tones.some((tone) => tone !== "success")) {
    return { label: "Building", tone: "info" };
  }
  return { label: "Deployed", tone: "success" };
}
