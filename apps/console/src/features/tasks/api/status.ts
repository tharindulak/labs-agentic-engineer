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

// The four chip states of the task list (#173 decisions): the user watches
// chips go green; failures must stand out (humans intervene on failure).
// An unknown derivedStatus renders red with its raw value so nothing hides.
export interface TaskChip {
  label: string;
  tone: StatusTone;
}

const CHIP_BY_STATUS: Record<string, TaskChip> = {
  pending: { label: "Pending", tone: "neutral" },
  on_hold: { label: "On hold", tone: "warning" },
  in_progress: { label: "Ongoing", tone: "info" },
  ready_for_review: { label: "Ongoing", tone: "info" },
  merged: { label: "Ongoing", tone: "info" },
  building: { label: "Ongoing", tone: "info" },
  deployed: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "error" },
  rejected: { label: "Failed", tone: "error" },
  abandoned: { label: "Failed", tone: "error" },
};

export function taskChip(derivedStatus: string): TaskChip {
  return CHIP_BY_STATUS[derivedStatus] ?? { label: derivedStatus, tone: "error" };
}

// Non-terminal statuses: while any task is in one of these, the list keeps
// polling; once everything settles, polling stops (#173 decisions).
const ACTIVE_STATUSES = new Set([
  "pending",
  "on_hold",
  "in_progress",
  "ready_for_review",
  "merged",
  "building",
]);

export function isActiveStatus(derivedStatus: string): boolean {
  return ACTIVE_STATUSES.has(derivedStatus);
}
