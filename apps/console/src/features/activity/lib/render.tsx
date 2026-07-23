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

type ActivityEvent = components["schemas"]["ActivityEvent"];

export interface ActivityLine {
  id: string;
  actor: string;
  text: string;
  tone: StatusTone;
  occurredAt: string;
}

const TONE_BY_TYPE: Record<string, StatusTone> = {
  spec_updated: "neutral",
  spec_published: "neutral",
  plan_derived: "neutral",
  task_started: "info",
  task_deployed: "success",
  task_failed: "error",
};

// Viewer-relative actor label: the event's own actorName is a stored
// display name, but the current user reads better as "You" than as their
// own name reflected back at them.
function actorLabel(e: ActivityEvent, currentUserEmail: string): string {
  if (e.actorKind === "user" && e.actorId && e.actorId === currentUserEmail) {
    return "You";
  }
  return e.actorName;
}

function issueRef(e: ActivityEvent): string {
  const n = e.issue ? `#${e.issue}` : "";
  return e.title ? `${n} ${e.title}`.trim() : n;
}

function bodyText(e: ActivityEvent): string {
  switch (e.type) {
    case "spec_updated":
      return e.title ? `updated the spec — ${e.title}` : "updated the spec";
    case "spec_published":
      return `published spec ${e.tag ?? ""} and started build`.replace(/\s+/g, " ").trim();
    case "plan_derived":
      return "derived build tasks from the architecture";
    case "task_started":
      return `started ${issueRef(e)}`.trim();
    case "task_deployed":
      return `deployed ${issueRef(e)}`.trim();
    case "task_failed":
      return `failed task ${issueRef(e)}`.trim();
    default:
      return e.type;
  }
}

export function activityLine(e: ActivityEvent, currentUserEmail: string): ActivityLine {
  return {
    id: e.id,
    actor: actorLabel(e, currentUserEmail),
    text: bodyText(e),
    tone: TONE_BY_TYPE[e.type] ?? "neutral",
    occurredAt: e.occurredAt,
  };
}
